import { expect } from "chai";
import { ethers } from "hardhat";

describe("AdviceNotary", function () {
  it("registers and reads a record", async function () {
    const [user] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("AdviceNotary");
    const notary = await Factory.deploy();
    await notary.waitForDeployment();

    const recordHash = ethers.keccak256(
      ethers.toUtf8Bytes("example-advice")
    );
    const metaHash = ethers.keccak256(
      ethers.toUtf8Bytes("model:gpt-4;temp:0.2")
    );
    const uri = "ipfs://example-cid";

    await notary.register(recordHash, metaHash, uri);

    const res = await notary.get(recordHash);
    expect(res.exists).to.eq(true);
    expect(res.author).to.eq(user.address);
    expect(res.metaHash).to.eq(metaHash);
    expect(res.uri).to.eq(uri);
  });

  it("rejects duplicate recordHash", async function () {
    const Factory = await ethers.getContractFactory("AdviceNotary");
    const notary = await Factory.deploy();
    await notary.waitForDeployment();

    const hash = ethers.keccak256(ethers.toUtf8Bytes("same"));

    await notary.register(hash, ethers.ZeroHash, "");
    await expect(
      notary.register(hash, ethers.ZeroHash, "")
    ).to.be.revertedWith("ALREADY_EXISTS");
  });
});

