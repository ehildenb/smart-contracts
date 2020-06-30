const axios = require('axios');
const Web3 = require('web3');
const { contract, accounts, web3 } = require('@openzeppelin/test-environment');
const { ether, time } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');
const { encode1 } = require('./external');
const { logEvents, hex } = require('../utils/helpers');

const MemberRoles = contract.fromArtifact('MemberRoles');
const NXMaster = contract.fromArtifact('NXMaster');
const NXMToken = contract.fromArtifact('NXMToken');
const Governance = contract.fromArtifact('Governance');
const PooledStaking = contract.fromArtifact('PooledStaking');
const TokenFunctions = contract.fromArtifact('TokenFunctions');
const ClaimsReward = contract.fromArtifact('ClaimsReward');
const ProposalCategory = contract.fromArtifact('ProposalCategory');
const TokenData = contract.fromArtifact('TokenData');
const Quotation = contract.fromArtifact('Quotation');
const TokenController = contract.fromArtifact('TokenController');
const UpgradeabilityProxy = contract.fromArtifact('UpgradeabilityProxy');

const BN = web3.utils.BN;
const directWeb3 = new Web3(process.env.TEST_ENV_FORK);

const newContractAddressUpgradeCategoryId = 29;
const newProxyContractAddressUpgradeCategoryId = 5;
const addNewInternalContractCategoryId = 34;
const VALID_DAYS = 250;
const MASTER_ADDRESS = '0x01bfd82675dbcc7762c84019ca518e701c0cd07e';

function getWeb3Contract (name, versionData, web3) {
  const contractData = versionData.mainnet.abis.filter(abi => abi.code === name)[0];
  const contract = new web3.eth.Contract(JSON.parse(contractData.contractAbi), contractData.address);
  console.log(`Loaded contract ${name} at address ${contractData.address}`);
  return contract;
}

async function getMemberStakes (member, td) {

  const stakedContractLength = await td.methods.getStakerStakedContractLength(member).call();
  const stakes = [];

  for (let i = 0; i < stakedContractLength; i++) {
    const stake = await td.methods.stakerStakedContracts(member, i).call();
    console.log(stake);
    const { dateAdd, stakeAmount: initialStake, stakedContractAddress: contractAddress, burnedAmount } = stake;
    stakes.push({
      dateAdd: new BN(dateAdd),
      initialStake: new BN(initialStake),
      contractAddress,
      burnedAmount: new BN(burnedAmount),
    });
  }

  return stakes;
}

async function submitGovernanceProposal (categoryId, actionHash, members, gv, submitter) {

  const proposalId = await gv.getProposalLength();

  console.log(`Creating proposal ${proposalId}..`);
  const proposalTitle = 'proposal';
  const proposalSD = 'proposal';
  const proposalDescHash = 'proposal';
  const incentive = 0;
  const solutionHash = 'proposal';
  await gv.createProposal(proposalTitle, proposalSD, proposalDescHash, 0, { from: submitter });

  console.log(`Categorizing proposal ${proposalId}..`);
  await gv.categorizeProposal(proposalId, categoryId, incentive, { from: submitter });

  console.log(`Submitting proposal ${proposalId}..`);
  await gv.submitProposalWithSolution(proposalId, 'proposal', actionHash, { from: submitter });

  // console.log(`createProposalwithSolution`);
  //  await gv.createProposalwithSolution(
  //   proposalTitle,
  //   proposalSD,
  //   proposalDescHash,
  //   categoryId,
  //   solutionHash,
  //   actionHash, {
  //     from: submitter
  //    });

  for (let i = 0; i < members.length; i++) {
    console.log(`Voting from ${members[i]} for ${proposalId}..`);
    try {
      logEvents(await gv.submitVote(proposalId, 1, { from: members[i] }));
    } catch (e) {
      console.error(`Failed to submitVote for member ${i} with address ${members[i]}`);
      throw e;
    }
  }

  const increase = 604800;
  console.log(`Advancing time by ${increase} seconds to allow proposal closing..`);
  await time.increase(increase);

  console.log(`Closing proposal..`);
  logEvents(await gv.closeProposal(proposalId, { from: submitter }));

  const proposal = await gv.proposal(proposalId);
  assert.equal(proposal[2].toNumber(), 3);
}

describe('fix upgrade', function () {
  // this.timeout(0);
  this.timeout(5000000);
  this.slow(2000);

  it('upgrades old system', async function () {
    const master = await NXMaster.at(MASTER_ADDRESS);

    const mr = await MemberRoles.at(await master.getLatestAddress(hex('MR')));
    // const tk = await NXMToken.at(await master.dAppToken());
    const gv = await Governance.at(await master.getLatestAddress(hex('GV')));
    // const pc = await ProposalCategory.at(await master.getLatestAddress('PC'));
    // const td = await TokenData.at(await master.getLatestAddress('TD'));

    // const directMR = getWeb3Contract('MR', versionData, directWeb3);
    // const directTD = getWeb3Contract('TD', versionData, directWeb3);
    // const directTF = getWeb3Contract('TF', versionData, directWeb3);
    // const directTK = getWeb3Contract('NXMTOKEN', versionData, directWeb3);

    const owners = await mr.members('3');
    const firstBoardMember = owners.memberArray[0];

    const members = await mr.members('1');
    const boardMembers = members.memberArray;
    const secondBoardMember = boardMembers[1];

    assert.equal(boardMembers.length, 5);
    console.log('Board members:', boardMembers);

    const [funder] = accounts;

    for (const member of boardMembers) {
      console.log(`Topping up ${member}`);
      await web3.eth.sendTransaction({ from: funder, to: member, value: ether('100') });
    }

    const newTC = await TokenController.new({ from: firstBoardMember });

    console.log(`PS address: ${await master.getLatestAddress(hex('PS'))}`);

    const upgradeMultipleImplementationsActionHash = encode1(
      ['bytes2[]', 'address[]'],
      [[hex('TC')], [newTC.address]],
    );

    await submitGovernanceProposal(
      newProxyContractAddressUpgradeCategoryId,
      upgradeMultipleImplementationsActionHash, boardMembers, gv, secondBoardMember,
    );

    const tcProxy = await UpgradeabilityProxy.at(await master.getLatestAddress(hex('TC')));
    const storedNewTCAddress = await tcProxy.implementation();
    assert.equal(storedNewTCAddress, newTC.address);
    console.log(`Successfully deployed new TC.`);
    const currentTC = TokenController.at(tcProxy.address);

    console.log(`currentTC ${currentTC.address}`);
    console.log(`currentTC.pooledStaking ${await currentTC.pooledStaking()}`);
    console.log(`currentTC.minCALockTime ${await currentTC.minCALockTime()}`);
  })
})
