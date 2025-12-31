import { ethers } from "hardhat";

async function main() {
  console.log("Deploying AdviceNotary...");

  const Factory = await ethers.getContractFactory("AdviceNotary");
  const notary = await Factory.deploy();
  await notary.waitForDeployment();

  const address = await notary.getAddress();
  console.log("✅ AdviceNotary deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
