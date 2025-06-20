import { publicKey } from "@metaplex-foundation/umi";
import { Action } from "solana-agent-kit";
import { SolanaAgentKit } from "solana-agent-kit";
import { z } from "zod";
import { search_assets } from "../tools/search_assets";

const searchAssetsAction: Action = {
  name: "SEARCH_ASSETS",
  similes: ["search assets", "find assets", "lookup assets", "query assets"],
  description: `Search for assets using various criteria with the Metaplex DAS API.`,
  examples: [
    [
      {
        input: {
          owner: publicKey("N4f6zftYsuu4yT7icsjLwh4i6pB1zvvKbseHj2NmSQw"),
          jsonUri:
            "https://arweave.net/c9aGs5fOk7gD4wWnSvmzeqgtfxAGRgtI1jYzvl8-IVs/chiaki-violet-azure-common.json",
        },
        output: {
          status: "success",
          message: "Assets retrieved successfully",
          result: {
            total: 2,
            limit: 10,
            items: [
              {
                interface: "V1_NFT",
                id: "ExampleAssetId1",
                content: {
                  json_uri: "https://example.com/asset1.json",
                  metadata: {
                    name: "Example Asset 1",
                    symbol: "EXA1",
                  },
                },
                authorities: [],
                compression: {},
                grouping: [],
                royalty: {},
                creators: [],
                ownership: {},
                supply: {},
                mutable: true,
                burnt: false,
              },
              {
                interface: "V1_NFT",
                id: "ExampleAssetId2",
                content: {
                  json_uri: "https://example.com/asset2.json",
                  metadata: {
                    name: "Example Asset 2",
                    symbol: "EXA2",
                  },
                },
                authorities: [],
                compression: {},
                grouping: [],
                royalty: {},
                creators: [],
                ownership: {},
                supply: {},
                mutable: true,
                burnt: false,
              },
            ],
          },
        },
        explanation: "Search for assets using various criteria",
      },
    ],
  ],
  schema: z.object({
    negate: z.boolean().nullable(),
    conditionType: z.enum(["all", "any"]).nullable(),
    interface: z.string().nullable(),
    jsonUri: z.string().nullable(),
    owner: z.string().nullable(),
    ownerType: z.enum(["single", "token"]).nullable(),
    creator: z.string().nullable(),
    creatorVerified: z.boolean().nullable(),
    authority: z.string().nullable(),
    // NOTE: this breaks the schema for some reason
    // grouping: z.tuple([z.string(), z.string()]).nullable(),
    delegate: z.string().nullable(),
    frozen: z.boolean().nullable(),
    supply: z.number().nullable(),
    supplyMint: z.string().nullable(),
    compressed: z.boolean().nullable(),
    compressible: z.boolean().nullable(),
    royaltyModel: z.enum(["creators", "fanout", "single"]).nullable(),
    royaltyTarget: z.string().nullable(),
    royaltyAmount: z.number().nullable(),
    burnt: z.boolean().nullable(),
    limit: z.number().nullable(),
    page: z.number().nullable(),
    before: z.string().nullable(),
    after: z.string().nullable(),
  }),
  handler: async (
    agent: SolanaAgentKit,
    input: z.infer<typeof searchAssetsAction.schema>
  ) => {
    const result = await search_assets(agent, input);

    return {
      status: "success",
      message: "Assets retrieved successfully",
      result,
    };
  },
};

export default searchAssetsAction;
