require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY         = process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const POLYGON_RPC         = process.env.POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology";
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat:  { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    polygonAmoy: {
      url:      POLYGON_RPC,
      accounts: [PRIVATE_KEY],
      chainId:  80002,
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: { polygonAmoy: POLYGONSCAN_API_KEY },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL:     "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },
  gasReporter: {
    enabled:  process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};