import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyUint } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("Notary", function () {
  async function deployNotary() {
    const [user, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("Notary");
    const notary = await Factory.deploy();
    await notary.waitForDeployment();
    return { notary, user, other };
  }

  const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("document-v1"));

  it("registers a hash and reads the record back", async function () {
    const { notary, user } = await loadFixture(deployNotary);

    const tx = await notary.notarize(sampleHash);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);

    const [author, timestamp, exists] = await notary.getRecord(sampleHash);
    expect(exists).to.eq(true);
    expect(author).to.eq(user.address);
    expect(timestamp).to.eq(block!.timestamp);
  });

  it("emits Notarized with hash, author and timestamp", async function () {
    const { notary, user } = await loadFixture(deployNotary);

    await expect(notary.notarize(sampleHash))
      .to.emit(notary, "Notarized")
      .withArgs(sampleHash, user.address, anyUint);
  });

  it("isNotarized flips from false to true", async function () {
    const { notary } = await loadFixture(deployNotary);

    expect(await notary.isNotarized(sampleHash)).to.eq(false);
    await notary.notarize(sampleHash);
    expect(await notary.isNotarized(sampleHash)).to.eq(true);
  });

  it("rejects a duplicate hash, including from another account", async function () {
    const { notary, other } = await loadFixture(deployNotary);

    await notary.notarize(sampleHash);
    await expect(notary.notarize(sampleHash)).to.be.revertedWith("Already notarized");
    await expect(notary.connect(other).notarize(sampleHash)).to.be.revertedWith(
      "Already notarized"
    );
  });

  it("rejects the zero hash", async function () {
    const { notary } = await loadFixture(deployNotary);

    await expect(notary.notarize(ethers.ZeroHash)).to.be.revertedWith("Empty hash");
  });

  it("returns an empty record for an unknown hash", async function () {
    const { notary } = await loadFixture(deployNotary);

    const [author, timestamp, exists] = await notary.getRecord(sampleHash);
    expect(exists).to.eq(false);
    expect(author).to.eq(ethers.ZeroAddress);
    expect(timestamp).to.eq(0n);
  });

  describe("anchorRoot", function () {
    const sampleRoot = ethers.keccak256(ethers.toUtf8Bytes("merkle-root"));

    it("anchors a root readable via getRecord/isNotarized", async function () {
      const { notary, user } = await loadFixture(deployNotary);

      await notary.anchorRoot(sampleRoot, 100);

      expect(await notary.isNotarized(sampleRoot)).to.eq(true);
      const [author, , exists] = await notary.getRecord(sampleRoot);
      expect(exists).to.eq(true);
      expect(author).to.eq(user.address);
    });

    it("emits RootAnchored with leaf count", async function () {
      const { notary, user } = await loadFixture(deployNotary);

      await expect(notary.anchorRoot(sampleRoot, 42))
        .to.emit(notary, "RootAnchored")
        .withArgs(sampleRoot, user.address, anyUint, 42);
    });

    it("rejects duplicate root, also across notarize/anchorRoot", async function () {
      const { notary } = await loadFixture(deployNotary);

      await notary.anchorRoot(sampleRoot, 2);
      await expect(notary.anchorRoot(sampleRoot, 2)).to.be.revertedWith("Already notarized");
      await expect(notary.notarize(sampleRoot)).to.be.revertedWith("Already notarized");
    });

    it("rejects the zero root", async function () {
      const { notary } = await loadFixture(deployNotary);

      await expect(notary.anchorRoot(ethers.ZeroHash, 1)).to.be.revertedWith("Empty hash");
    });
  });
});
