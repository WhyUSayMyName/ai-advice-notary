import path from "path";
import { subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import type { SolcBuild } from "hardhat/types";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// 1) Проверка: если это НЕ появится в консоли — значит файл не сохранён/не тот каталог
console.log("✅ hardhat.config.ts loaded");

// 2) Берём solc-js из node_modules (у тебя он есть)
const soljsonPath = path.join(__dirname, "node_modules", "solc", "soljson.js");

// 3) Достаём точную longVersion (с commit) прямо из solc, чтобы Hardhat не пытался “уточнять”
const solc = require("solc");
const longVersion: string = solc.version(); // например: "0.8.24+commit.e11b9ed9...."

// 4) Жёстко подменяем “получение сборки solc” на локальную
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async () => {
  const build: SolcBuild = {
    compilerPath: soljsonPath,
    isSolcJs: true,
    version: "0.8.24",
    longVersion,
  };

  console.log("✅ Using local solc:", build.longVersion);
  console.log("✅ soljson path:", build.compilerPath);

  return build;
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
