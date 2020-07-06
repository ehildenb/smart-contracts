const { hex } = require('../test/utils/helpers');
const { setupLoader } = require('@openzeppelin/contract-loader');
const Web3 = require('web3');
const fs = require('fs');

const STAKER_MIGRATION_COMPLETED_EVENT = 'StakersMigrationCompleted';
const MIGRATED_MEMBER_EVENT = 'MigratedMember';
const MASTER_ADDRESS = '0x01bfd82675dbcc7762c84019ca518e701c0cd07e';
const GWEI_IN_WEI = 10e9;


const providerURL = process.env.PROVIDER_URL;


const BN = Web3.utils.BN;

function chunk (arr, chunkSize) {
  const chunks = [];
  let i = 0;
  const n = arr.length;

  while (i < n) {
    chunks.push(arr.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks;
}



async function getStakerContractStakes(pooledStaking, member) {
  const contracts = await pooledStaking.stakerContractsArray(member);
  for (let contract of contracts) {
    const contractStake = (await pooledStaking.stakerContractStake(member, contract)).toString();
    console.log({
      member,
      contract,
      contractStake
    });
  }
}

async function checkHistoricalStakingData(master, web3) {
  const tk = new web3.eth.Contract(require('../build/contracts/NXMToken').abi, await master.dAppToken());

  const migrationStartBlock = 10362897;
  const tcAddress = await master.getLatestAddress(hex('TC'));
  const crAddress = await master.getLatestAddress(hex('CR'));


  // await master.getLatestAddress(hex('TC'))

  // let bal;
  // bal = await tk.methods.totalSupply().call(undefined);
  // console.log(`bal=${bal}`);
  //
  // console.log(`PRE-MIGRATION`);
  // let [totalSupply, tcBal] = await Promise.all([
  //   tk.methods.totalSupply().call(undefined, migrationStartBlock),
  //   tk.methods.balanceOf(tcAddress).call(undefined, migrationStartBlock)
  //   ]);
  // console.log(`bal pre-migration=${totalSupply}`);
  // console.log(`TC.bal = ${tcBal}`);


  const members = fs.readFileSync('./members.txt', 'utf8').split(',').map(a => a.trim());
  console.log(`members: ${members.length}`);

  const masterWeb3 = new web3.eth.Contract(require('../build/contracts/NXMaster').abi, MASTER_ADDRESS);

  const oldTFAddress = await masterWeb3.methods.getLatestAddress(hex('TF'))
    .call(undefined, migrationStartBlock);
  const oldTF = new web3.eth.Contract(require('../TokenFunctions').abi, oldTFAddress);
  let totalUnlockable = new BN('0');

  const chunks = chunk(members, 50);
  let batchCount = 0;
  for (let chunk of chunks) {
    console.log(`Fetching batch ${batchCount++}..`);
    await Promise.all(chunk.map(async (member) => {
      const unlockable = await oldTF.methods.getStakerAllUnlockableStakedTokens(member)
        .call(undefined, migrationStartBlock);

      totalUnlockable = totalUnlockable.add(new BN(unlockable));
      console.log(`${member}: ${unlockable}`);
    }));
  }
  console.log(`totalUnlockable ${totalUnlockable.toString()}`);
  console.log(`DONE`);

  // const blockNumber = 8065000;
  // const block = await web3.eth.getBlock(blockNumber);
  // console.log(new Date(block.timestamp * 1000));
  // bal = await tk.methods.totalSupply().call(undefined, blockNumber);
  // console.log(`bal=${bal}`);
}

async function checkTCTransfer(master, loader) {
  const tk = loader.fromArtifact('NXMToken', await master.dAppToken());
  const events = await tk.getPastEvents('Transfer', { fromBlock: 10366000, toBlock: 10367060  });

  // https://etherscan.io/address/0x1c1bc0cdd905b29494cbd485657dae8a95f30ec8
  const transfers  = events
    .filter(e => e.args.from === '0x5407381b6c251cFd498ccD4A1d877739CB7960B8')
    .filter(e => e.args.to !== '0x0000000000000000000000000000000000000000')
    .map(e => e.args.value);

  const sumFromTC = transfers.reduce((a, b) => a.add(b), new BN('0'))
  console.log(`sumFromTC ${sumFromTC.toString()}`);

  console.log(await tk.balanceOf( await master.getLatestAddress(hex('PS'))));
}

async function main() {


  const web3 = new Web3(providerURL);
  const loader = setupLoader({
    provider: web3.currentProvider,
    defaultGas: 12e8, // 1 million
    defaultGasPrice: 6e9, // 5 gwei
  }).truffle;


  console.log(`Loading master at ${MASTER_ADDRESS}..`)
  const master = loader.fromArtifact('MasterMock', MASTER_ADDRESS);

  const mrWeb3 = new web3.eth.Contract(require('../build/contracts/MemberRoles').abi, await master.getLatestAddress(hex('MR')));
  const { memberArray: allMembers }  = await mrWeb3.methods.members('2').call();
  console.log(`allMember = ${allMembers.length}`);

  return;
  await checkHistoricalStakingData(master, web3);


  console.log(`Expected PS: ${await master.getLatestAddress(hex('PS'))}`);
  const tfAddress = await master.getLatestAddress(hex('TF'));

  console.log('TF:');
  console.log(await web3.eth.getStorageAt(tfAddress, 10));
  console.log(await web3.eth.getStorageAt(tfAddress, 11));

  console.log('CR:');
  const crAddress = await master.getLatestAddress(hex('CR'));
  console.log(await web3.eth.getStorageAt(crAddress, 12));
  console.log(await web3.eth.getStorageAt(crAddress, 13));

  const tc = loader.fromArtifact('TokenController', await master.getLatestAddress(hex('TC')));
  console.log(`TokenController.pooledStaking = ${await tc.pooledStaking()}`);
  return;

  const roxana = '0x144aAD1020cbBFD2441443721057e1eC0577a639';

  const hugh = '0x87b2a7559d85f4653f13e6546a14189cd5455d45';

  const tcAddress = await master.getLatestAddress(hex('TC'));
  console.log(`tcAddress ${tcAddress}`);
  const tokenController = loader.fromArtifact('TokenController', tcAddress);

  const mrAddress = await master.getLatestAddress(hex('MR'));
  const mr = loader.fromArtifact('MemberRoles', mrAddress);

  const tokenFunctions = loader.fromArtifact('TokenFunctions', await master.getLatestAddress(hex('TF')));

  const psAddress = await master.getLatestAddress(hex('PS'));
  console.log(`Loading PooledStaking at ${psAddress}..`)
  const pooledStaking = loader.fromArtifact('PooledStaking', psAddress);

  console.log(`HUGH:`);
  await getStakerContractStakes(pooledStaking, hugh);
  console.log(`==========================================`);
  console.log(`ROXANA:`);
  await getStakerContractStakes(pooledStaking, roxana);

  console.log(`pooledStaking.master ${await pooledStaking.master()}`);
  console.log(`pooledStaking.tokenController ${await pooledStaking.tokenController()}`);
  console.log(`pooledStaking.token ${await pooledStaking.token()}`);

  const now = new Date().getTime();

  console.log(await tokenController.pooledStaking());
  console.log(await tokenController.minCALockTime());
  console.log(await tokenController.token());



  const nxmToken = loader.fromArtifact('NXMToken', await master.dAppToken());

  const psBalance = await nxmToken.balanceOf(pooledStaking.address);
  console.log(`psBalance ${psBalance}`);

  // const mr = loader.fromArtifact('MemberRoles', await master.getLatestAddress(hex('MR')));
  const members = fs.readFileSync('./members.txt', 'utf8').split(',').map(a => a.trim());
  console.log(`members: ${members.length}`);

  const deposits = {};
  const chunks = chunk(members, 50);
  let batchCount = 0;
  for (let chunk of chunks) {
    console.log(`Fetching batch ${batchCount++}..`);
    await Promise.all(chunk.map(async (member) => {
      deposits[member] = await pooledStaking.stakerDeposit(member);
    }));
  }
  console.log(`Finished fetching deposits.`);

  let sum = new BN('0');
  for (const deposit of Object.values(deposits)) {
    sum = sum.add(deposit);
  }
  console.log(`SUM: ${sum.toString()}`);
}

main().catch(e => {
  console.error(`FATAL: `, e);
})
