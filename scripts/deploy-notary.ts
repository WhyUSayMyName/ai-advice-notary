import { ethers } from "hardhat";

async function main() {
  const Notary = await ethers.getContractFactory("Notary");
  const notary = await Notary.deploy();
  await notary.waitForDeployment();

  const addr = await notary.getAddress();
  console.log("NOTARY_ADDRESS=", addr);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
