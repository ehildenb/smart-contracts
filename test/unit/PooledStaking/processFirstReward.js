const { ether, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');

const { accounts, constants } = require('../utils');
const setup = require('../setup');
const { ParamType } = constants;

const {
  members: [memberOne, memberTwo, memberThree],
  internalContracts: [internalContract],
  nonInternalContracts: [nonInternal],
  governanceContracts: [governanceContract],
} = accounts;

const firstContract = '0x0000000000000000000000000000000000000001';
const secondContract = '0x0000000000000000000000000000000000000002';
const thirdContract = '0x0000000000000000000000000000000000000003';

async function fundApproveDepositStake (token, staking, amount, contract, member) {
  await staking.updateParameter(ParamType.MAX_EXPOSURE, ether('2'), { from: governanceContract });

  await token.transfer(member, amount); // fund member account from default address
  await token.approve(staking.address, amount, { from: member });

  await staking.depositAndStake(amount, [contract], [amount], { from: member });
}

describe('processFirstReward', function () {

  beforeEach(setup);

  it('should mint the reward amount in the PS contract', async function () {
    const { token, staking } = this;
    await fundApproveDepositStake(token, staking, ether('10'), firstContract, memberOne);

    await staking.pushReward(firstContract, ether('2'), { from: internalContract });
    await staking.processPendingActions();

    const currentBalance = await token.balanceOf(staking.address);
    const expectedBalance = ether('12');
    assert(
      currentBalance.eq(expectedBalance),
      `Expected balance of staking contract ${expectedBalance}, found ${currentBalance}`,
    );
  });

  it('should reward stakers proportionally to their stake', async function () {
    const { token, staking } = this;

    await staking.pushReward(firstContract, ether('20'), { from: internalContract });
    await expectRevert(
      fundApproveDepositStake(token, staking, ether('100'), firstContract, memberOne),
      `Unable to execute request with unprocessed actions`,
    );

    await time.advanceBlock();
    await staking.processPendingActions();

    await fundApproveDepositStake(token, staking, ether('100'), firstContract, memberOne);
    await fundApproveDepositStake(token, staking, ether('180'), firstContract, memberTwo);
    await fundApproveDepositStake(token, staking, ether('230'), firstContract, memberThree);

    await staking.pushReward(firstContract, ether('50'), { from: internalContract });
    await time.advanceBlock();
    await staking.processPendingActions();

    const rewardOne = await staking.stakerReward(memberOne);
    assert.equal(
      rewardOne.toString(),
      '9803921568627450980',
      `Expected rewardOne to be 9803921568627450980, found ${rewardOne}`,
    );

    const rewardTwo = await staking.stakerReward(memberTwo);
    assert.equal(
      rewardTwo.toString(),
      '17647058823529411764',
      `Expected rewardOne to be 17647058823529411764, found ${rewardTwo}`,
    );

    const rewardThree = await staking.stakerReward(memberThree);
    assert.equal(
      rewardThree.toString(),
      '22549019607843137254',
      `Expected rewardOne to be 22549019607843137254, found ${rewardThree}`,
    );
  });

  it('should reward stakers proportionally to their stake, after a burn', async function () {
    const { token, staking } = this;

    await fundApproveDepositStake(token, staking, ether('100'), firstContract, memberOne);
    await fundApproveDepositStake(token, staking, ether('200'), firstContract, memberTwo);
    await fundApproveDepositStake(token, staking, ether('300'), firstContract, memberThree);

    // Burn 200
    await time.advanceBlock();
    await staking.pushBurn(firstContract, ether('500'), { from: internalContract });
    await time.advanceBlock();
    await staking.processPendingActions();

    const stakeOne = await staking.stakerContractStake(memberOne, firstContract);
    assert.equal(
      stakeOne.toString(),
      '16666666666666666667',
      `Expected stakeOne to be 16666666666666666667, found ${stakeOne}`,
    );
    const stakeTwo = await staking.stakerContractStake(memberTwo, firstContract);
    assert.equal(
      stakeTwo.toString(),
      '33333333333333333334',
      `Expected stakeOne to be 33333333333333333334, found ${stakeTwo}`,
    );
    const stakeThree = await staking.stakerContractStake(memberThree, firstContract);
    assert.equal(
      stakeThree.toString(),
      '50000000000000000000',
      `Expected stakeOne to be 50000000000000000000, found ${stakeThree}`,
    );

    // Reward 50
    await time.advanceBlock();
    await staking.pushReward(firstContract, ether('50'), { from: internalContract });
    await time.advanceBlock();
    await staking.processPendingActions();

    const rewardOne = await staking.stakerReward(memberOne);
    assert.equal(
      rewardOne.toString(),
      '8333333333333333333',
      `Expected rewardOne to be 8333333333333333333, found ${rewardOne}`,
    );
    const rewardTwo = await staking.stakerReward(memberTwo);
    assert.equal(
      rewardTwo.toString(),
      '16666666666666666666',
      `Expected rewardOne to be 16666666666666666666, found ${rewardTwo}`,
    );
    const rewardThree = await staking.stakerReward(memberThree);
    assert.equal(
      rewardThree.toString(),
      '24999999999999999999',
      `Expected rewardOne to be 24999999999999999999, found ${rewardThree}`,
    );
  });

  it.only('should reward staker correctly, after a burn on another contract', async function () {
    const { token, staking } = this;

    // Deposit and stake
    await fundApproveDepositStake(token, staking, ether('200'), firstContract, memberOne);
    await staking.depositAndStake(
      ether('0'),
      [firstContract, secondContract, thirdContract],
      [ether('200'), ether('50'), ether('150')],
      { from: memberOne },
    );
    await fundApproveDepositStake(token, staking, ether('200'), thirdContract, memberTwo);

    let stakerOneDeposit = await staking.stakerDeposit(memberOne);
    assert(
      stakerOneDeposit.eq(ether('200')),
      `Expected staker one deposit before the burn to be ${ether('200')}, found ${stakerOneDeposit}`,
    );
    let stakerTwoDeposit = await staking.stakerDeposit(memberTwo);
    assert(
      stakerTwoDeposit.eq(ether('200')),
      `Expected staker two deposit after the burn to be ${ether('200')}, found ${stakerTwoDeposit}`,
    );

    // Push reward 20 on secondContract
    await staking.pushReward(secondContract, ether('20'), { from: internalContract });
    await time.advanceBlock();

    // Burn 100 on firstContract
    await staking.pushBurn(firstContract, ether('100'), { from: internalContract });
    await time.advanceBlock();

    // Push reward 30 on thirdContract
    await staking.pushReward(thirdContract, ether('30'), { from: internalContract });
    await time.advanceBlock();

    // Process Actions
    await staking.processPendingActions();
    await time.advanceBlock();

    stakerOneDeposit = await staking.stakerDeposit(memberOne);
    assert(
      stakerOneDeposit.eq(ether('100')),
      `Expected staker one deposit after the burn to be ${ether('100')}, found ${stakerOneDeposit}`,
    );
    stakerTwoDeposit = await staking.stakerDeposit(memberTwo);
    assert(
      stakerTwoDeposit.eq(ether('200')),
      `Expected staker two deposit after the burn to be ${ether('200')}, found ${stakerTwoDeposit}`,
    );

    // Check stakes
    const stakeOne = await staking.stakerContractStake(memberOne, firstContract);
    assert.equal(
      stakeOne.toString(),
      '100000000000000000000',
      `Expected stakeOne to be 100000000000000000000, found ${stakeOne}`,
    );
    const stakeTwo = await staking.stakerContractStake(memberOne, secondContract);
    assert.equal(
      stakeTwo.toString(),
      '50000000000000000000',
      `Expected stakeTwo to be 50000000000000000000, found ${stakeTwo}`,
    );
    const stakeThree = await staking.stakerContractStake(memberOne, thirdContract);
    assert.equal(
      stakeThree.toString(),
      '100000000000000000000',
      `Expected stakeThree to be 100000000000000000000, found ${stakeThree}`,
    );
    const stakeThreeMemberTwo = await staking.stakerContractStake(memberTwo, thirdContract);
    assert.equal(
      stakeThreeMemberTwo.toString(),
      '200000000000000000000',
      `Expected stakeThreeMemberTwo to be 200000000000000000000, found ${stakeThreeMemberTwo}`,
    );

    // Check rewards
    const reward = await staking.stakerReward(memberOne);
    assert.equal(
      reward.toString(),
      '30000000000000000000',
      `Expected reward to be 30000000000000000000, found ${reward}`,
    );

    const rewardTwo = await staking.stakerReward(memberTwo);
    assert.equal(
      rewardTwo.toString(),
      '20000000000000000000',
      `Expected reward two to be 20000000000000000000, found ${rewardTwo}`,
    );
  });

  it('should handle contracts with 0 stake', async function () {
    const { token, staking } = this;

    const preRewardBalance = await token.balanceOf(staking.address);

    await staking.pushReward(firstContract, ether('50'), { from: internalContract });
    await time.advanceBlock();
    await staking.processPendingActions();

    // Expect no rewards to have been minted
    const postRewardBalance = await token.balanceOf(staking.address);
    assert(
      postRewardBalance.eq(preRewardBalance),
      `Expected post reward balance of staking contract ${preRewardBalance}, found ${postRewardBalance}`,
    );
  });

  it('should emit Rewarded event', async function () {

    const { token, staking } = this;
    await fundApproveDepositStake(token, staking, ether('10'), firstContract, memberOne);

    const rewardAmount = ether('2');
    const reward = await staking.pushReward(firstContract, rewardAmount, { from: internalContract });
    const process = await staking.processPendingActions();

    expectEvent(process, 'Rewarded', {
      contractAddress: firstContract,
      amount: rewardAmount,
    });
  });
});
