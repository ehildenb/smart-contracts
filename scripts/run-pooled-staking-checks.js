const { hex } = require('../test/utils/helpers');
const { setupLoader } = require('@openzeppelin/contract-loader');
const Web3 = require('web3');
const fs = require('fs');

const STAKER_MIGRATION_COMPLETED_EVENT = 'StakersMigrationCompleted';
const MIGRATED_MEMBER_EVENT = 'MigratedMember';
const MASTER_ADDRESS = '0x01bfd82675dbcc7762c84019ca518e701c0cd07e';
const GWEI_IN_WEI = 10e9;


const providerURL = 'https://mainnet.infura.io/v3/8c4d7fcf0426485db01dd6f4626c81a2';
//const providerURL = 'https://parity.nexusmutual.io';


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


async function main() {


  const web3 = new Web3(providerURL);
  const loader = setupLoader({
    provider: web3.currentProvider,
    defaultGas: 12e8, // 1 million
    defaultGasPrice: 6e9, // 5 gwei
  }).truffle;

  console.log(`Loading master at ${MASTER_ADDRESS}..`)
  const master = loader.fromArtifact('MasterMock', MASTER_ADDRESS);
  const psAddress = await master.getLatestAddress(hex('PS'));
  console.log(`Loading PooledStaking at ${psAddress}..`)
  const pooledStaking = loader.fromArtifact('PooledStaking', psAddress);

  const nxmToken = loader.fromArtifact('NXMToken', await master.dAppToken());

  const psBalance = await nxmToken.balanceOf(pooledStaking.address);
  console.log(`psBalance ${psBalance}`);


  console.log(await master.getLatestAddress(hex('MR')));
  // const mr = loader.fromArtifact('MemberRoles', await master.getLatestAddress(hex('MR')));
  const mrWeb3 = new web3.eth.Contract(require('../build/contracts/MemberRoles').abi, await master.getLatestAddress(hex('MR')));
  //const { memberArray: members }  = await mrWeb3.methods.members('2').call();
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
