const axios = require('axios');
const Web3 = require('web3');
const { contract, accounts, web3 } = require('@openzeppelin/test-environment');
const { ether, time } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');
const { encode1, encode } = require('./external');
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

function getWeb3Contract (name, versionData, web3) {
  const contractData = versionData.mainnet.abis.filter(abi => abi.code === name)[0];
  const contract = new web3.eth.Contract(JSON.parse(contractData.contractAbi), contractData.address);
  console.log(`Loaded contract ${name} at address ${contractData.address}`);
  return contract;
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

describe('upgrade minCALockTime', function () {

  // this.timeout(0);
  this.timeout(5000000);
  this.slow(2000);

  it('upgrades old system', async function () {

    const {data: versionData} = await axios.get('https://api.nexusmutual.io/version-data/data.json');
    const [{address: masterAddress}] = versionData.mainnet.abis.filter(({code}) => code === 'NXMASTER');
    const master = await NXMaster.at(masterAddress);

    const {contractsName, contractsAddress} = await master.getVersionData();
    console.log(contractsName, contractsAddress);

    const nameToAddressMap = {
      NXMTOKEN: await master.dAppToken(),
    };

    for (let i = 0; i < contractsName.length; i++) {
      nameToAddressMap[web3.utils.toAscii(contractsName[i])] = contractsAddress[i];
    }

    const mr = await MemberRoles.at(nameToAddressMap['MR']);
    const tk = await NXMToken.at(nameToAddressMap['NXMTOKEN']);
    const gv = await Governance.at(nameToAddressMap['GV']);
    const pc = await ProposalCategory.at(nameToAddressMap['PC']);
    const td = await TokenData.at(nameToAddressMap['TD']);
    const tc = await TokenController.at(nameToAddressMap['TC']);

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

    const newCategoryCategoryId = 3;
    let updateUintParametersForTokenControllerCategorId = await pc.totalCategories();
    let actionHash = encode(
      'newCategory(string,uint256,uint256,uint256,uint256[],uint256,string,address,bytes2,uint256[],string)',
      'Description',
      1,
      1,
      0,
      [1],
      604800,
      '',
      tc.address,
      hex('EX'),
      [0, 0, 0, 0],
      'updateUintParameters(bytes8,uint256)'
    );

    await submitGovernanceProposal(newCategoryCategoryId, actionHash, boardMembers, gv, secondBoardMember);
    console.log(`Successfully added newCategory.`);

    actionHash = encode(
      'updateUintParameters(bytes8,uint)',
      hex('MNCLT'),
      35
    );

    await submitGovernanceProposal(
      updateUintParametersForTokenControllerCategorId, actionHash, boardMembers, gv, secondBoardMember
    );

    const updatedminCALockTime = await tc.minCALockTime();
    console.log(`minCALockTime= ${updatedminCALockTime}`);

    // const upgradeMultipleContractsActionHash = encode1(
    //   ['bytes2[]', 'address[]'],
    //   [[hex('TF'), hex('CR'), hex('QT')], [newTF.address, newCR.address, newQT.address]],
    // );
    //
    // await submitGovernanceProposal(
    //   newContractAddressUpgradeCategoryId, upgradeMultipleContractsActionHash, boardMembers, gv, secondBoardMember,
    // );
    //

  })
})
