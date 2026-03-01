require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const POLYGON_RPC = process.env.POLYGON_AMOY_RPC_URL;
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || "";

if (!PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY missing in .env");
}

if (!POLYGON_RPC) {
  throw new Error("POLYGON_AMOY_RPC_URL missing in .env");
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },

    polygonAmoy: {
      url: POLYGON_RPC,
      accounts: [PRIVATE_KEY],
      chainId: 80002,
    },
  },

  etherscan: {
    apiKey: {
      polygonAmoy: POLYGONSCAN_API_KEY,
    },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};