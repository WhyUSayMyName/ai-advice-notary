import "dotenv/config";
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
// solc-js называет себя с суффиксом сборки: «0.8.24+commit.e11b9ed9.Emscripten.clang».
// Это тот же компилятор — тот же коммит, побайтно тот же результат, — но Etherscan
// строку с суффиксом не принимает, и верификация исходников падала с «Invalid Or
// Not supported solc version». Метка версии в байткод не попадает: в метаданные
// контракта компилятор пишет её сам.
const longVersion: string = solc.version().replace(/\.Emscripten\.clang$/, "");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async (): Promise<SolcBuild> => {
  return {
    compilerPath: soljsonPath,
    isSolcJs: true,
    version: "0.8.24",
    longVersion,
  };
});

// Ключ деплоя. Отдельный от ключа подписи в приложении: деплой делается
// один раз из командной строки, а якорит приложение — из хранилища ОС.
// Здесь ключ неизбежно лежит открытым текстом в .env, поэтому годится
// ТОЛЬКО одноразовый тестовый аккаунт без реальных средств.
const deployerKey = process.env.DEPLOYER_PK?.trim();
const accounts = deployerKey ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Локальный узел: npx hardhat node
    localhost: {
      url: process.env.RPC_URL ?? "http://127.0.0.1:8545",
    },
    // Публичный тестнет Ethereum. Без SEPOLIA_RPC_URL сеть остаётся
    // объявленной, но неработоспособной — hardhat скажет об этом внятно.
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? "",
      accounts,
      chainId: 11155111,
    },
  },
  etherscan: {
    // Верификация исходников контракта. Для аудитора это не украшение:
    // модель угроз требует, чтобы он мог прочитать РАЗВЁРНУТЫЙ код, а не
    // поверить оператору на слово, что задеплоено именно то, что в репозитории.
    apiKey: process.env.ETHERSCAN_API_KEY ?? "",
  },
};

export default config;
