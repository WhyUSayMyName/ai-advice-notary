import path from "path";
import { subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import type { SolcBuild } from "hardhat/types";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Используем solc-js из node_modules вместо скачивания компилятора из сети
// (позволяет собирать проект в офлайне и за строгим прокси).
const soljsonPath = path.join(__dirname, "node_modules", "solc", "soljson.js");
const solc = require("solc");
const longVersion: string = solc.version();

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async (): Promise<SolcBuild> => {
  return {
    compilerPath: soljsonPath,
    isSolcJs: true,
    version: "0.8.24",
    longVersion,
  };
});

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
};

export default config;
