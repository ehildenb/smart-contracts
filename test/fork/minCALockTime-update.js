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


async function submitGovernanceProposal (categoryId, actionHash, members, gv, submitter) {

  const proposalId = await gv.getProposalLength();

  console.log(`Creating proposal ${proposalId}..`);
  const proposalTitle = 'proposal';
  const proposalSD = 'proposal';
  const proposalDescHash = 'proposal';
  const incentive = 0;
  const solutionHash = 'proposal';
  // await gv.createProposal(proposalTitle, proposalSD, proposalDescHash, 0, { from: submitter });
  //
  // console.log(`Categorizing proposal ${proposalId}..`);
  // await gv.categorizeProposal(proposalId, categoryId, incentive, { from: submitter });
  //
  // console.log(`Submitting proposal ${proposalId}..`);
  // await gv.submitProposalWithSolution(proposalId, 'proposal', actionHash, { from: submitter });

  console.log(`createProposalwithSolution`);
   await gv.createProposalwithSolution(
    proposalTitle,
    proposalSD,
    proposalDescHash,
    categoryId,
    solutionHash,
    actionHash, {
      from: submitter
     });

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
    const gv = await Governance.at(nameToAddressMap['GV']);
    const pc = await ProposalCategory.at(nameToAddressMap['PC']);
    const tc = await TokenController.at(nameToAddressMap['TC']);

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
    let updateUintParametersForTokenControllerCategoryId = await pc.totalCategories();

    /*
      Model used:
      https://app.govblocks.io/proposals/NEXUS-MUTUAL/69
     */
    let actionHash = encode(
      'newCategory(string,uint256,uint256,uint256,uint256[],uint256,string,address,bytes2,uint256[],string)',
      'updateUintParameters for TokenController', // name |	Name of category
      1, // memberRoleToVote | Role ID authorised to vote
      60, // majorityVotePerc | Majority % required for acceptance
      15, // quorumPerc | Quorum % required for acceptance
      [2], // allowedToCreateProposal | Role Ids allowed to create proposal
      604800, // closingTime | 	Proposal closing time
      '', // actionHash | IPFS hash of action to be executed
      '', // contractAddress | Address of external contract for action execution (address appears to be ok if blank)
      hex('TC'), // contractName | 	Contract code of internal contract for action execution
      [0, 0, 0, 0], // other | [Minimum stake, incentives, Advisory Board % required, Is Special Resolution]
      'updateUintParameters(bytes8,uint256)' // functionHash | Function signature
    );

    await submitGovernanceProposal(newCategoryCategoryId, actionHash, boardMembers, gv, secondBoardMember);

    console.log(`Successfully added newCategory.`);

    const minCALockTimeInDays = 30;
    actionHash = encode(
      'updateUintParameters(bytes8,uint)',
      hex('MNCLT'), // bytes8 code for MNCLT. it's 0x4d4e434c54
      minCALockTimeInDays // number in days. eg. 30
    );

    console.log(`Using category id ${updateUintParametersForTokenControllerCategoryId}`);
    await submitGovernanceProposal(
      updateUintParametersForTokenControllerCategoryId, actionHash, boardMembers, gv, secondBoardMember
    );

    const updatedminCALockTime = await tc.minCALockTime();
    assert.equal(updatedminCALockTime, (minCALockTimeInDays * 24 * 60 * 60).toString());
  })
})
