/* eslint-disable @typescript-eslint/consistent-type-definitions */
// Vendor IDL file from julianfssen/jupiter-perps-anchor-idl-parsing — do not edit
export type Doves = {
  version: '0.1.0';
  name: 'doves';
  instructions: [
    {
      name: 'initialize';
      accounts: [
        {
          name: 'admin';
          isMut: true;
          isSigner: true;
        },
        {
          name: 'feed';
          isMut: true;
          isSigner: false;
        },
        {
          name: 'systemProgram';
          isMut: false;
          isSigner: false;
        },
      ];
      args: [
        {
          name: 'pair';
          type: {
            array: ['u8', 32];
          };
        },
        {
          name: 'feedSigner';
          type: {
            array: ['u8', 33];
          };
        },
      ];
    },
    {
      name: 'updateWithSigner';
      accounts: [
        {
          name: 'signer';
          isMut: false;
          isSigner: true;
        },
        {
          name: 'feed';
          isMut: true;
          isSigner: false;
        },
        {
          name: 'systemProgram';
          isMut: false;
          isSigner: false;
        },
      ];
      args: [
        {
          name: 'update';
          type: {
            defined: 'UpdateMessage';
          };
        },
        {
          name: 'raise';
          type: 'bool';
        },
      ];
    },
    {
      name: 'initializeAgPrice';
      accounts: [
        {
          name: 'signer';
          isMut: true;
          isSigner: true;
        },
        {
          name: 'agPriceFeed';
          isMut: true;
          isSigner: false;
        },
        {
          name: 'mint';
          isMut: false;
          isSigner: false;
        },
        {
          name: 'edgeFeed';
          isMut: false;
          isSigner: false;
        },
        {
          name: 'clFeed';
          isMut: false;
          isSigner: false;
        },
        {
          name: 'pythFeed';
          isMut: false;
          isSigner: false;
        },
        {
          name: 'systemProgram';
          isMut: false;
          isSigner: false;
        },
      ];
      args: [
        {
          name: 'config';
          type: {
            defined: 'Config';
          };
        },
      ];
    },
    {
      name: 'updateAgPriceFeed';
      accounts: [
        {
          name: 'signer';
          isMut: false;
          isSigner: true;
        },
        {
          name: 'agPriceFeed';
          isMut: true;
          isSigner: false;
        },
        {
          name: 'edgeFeed';
          isMut: false;
          isSigner: false;
        },
        {
          name: 'clFeed';
          isMut: false;
          isSigner: false;
        },
        {
          name: 'pythFeed';
          isMut: false;
          isSigner: false;
        },
      ];
      args: [];
    },
  ];
  accounts: [
    {
      name: 'agPriceFeed';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'mint';
            type: 'publicKey';
          },
          {
            name: 'edgeFeed';
            type: 'publicKey';
          },
          {
            name: 'clFeed';
            type: 'publicKey';
          },
          {
            name: 'pythFeed';
            type: 'publicKey';
          },
          {
            name: 'pythFeedId';
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'price';
            type: 'u64';
          },
          {
            name: 'expo';
            type: 'i8';
          },
          {
            name: 'timestamp';
            type: 'i64';
          },
          {
            name: 'config';
            type: {
              defined: 'Config';
            };
          },
          {
            name: 'bump';
            type: 'u8';
          },
        ];
      };
    },
    {
      name: 'priceFeed';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'pair';
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'signer';
            type: {
              array: ['u8', 33];
            };
          },
          {
            name: 'price';
            type: 'u64';
          },
          {
            name: 'expo';
            type: 'i8';
          },
          {
            name: 'timestamp';
            type: 'i64';
          },
          {
            name: 'bump';
            type: 'u8';
          },
        ];
      };
    },
  ];
  types: [
    {
      name: 'Config';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'maxAgPriceAgeSec';
            type: 'u32';
          },
          {
            name: 'maxPriceFeedAgeSec';
            type: 'u32';
          },
          {
            name: 'maxPriceDiffBps';
            type: 'u64';
          },
        ];
      };
    },
    {
      name: 'UpdateMessage';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'recoveryId';
            type: 'u8';
          },
          {
            name: 'signature';
            type: {
              array: ['u8', 64];
            };
          },
          {
            name: 'price';
            type: 'u64';
          },
          {
            name: 'expo';
            type: 'i8';
          },
          {
            name: 'timestamp';
            type: 'i64';
          },
        ];
      };
    },
  ];
  errors: [
    {
      code: 6000;
      name: 'ThresholdUnderflow';
      msg: 'Threshold must be >0';
    },
    {
      code: 6001;
      name: 'ThresholdOverflow';
      msg: 'Threshold must be <= whitelist length';
    },
    {
      code: 6002;
      name: 'ThresholdNotMet';
      msg: 'Number of signers must be >= threshold';
    },
    {
      code: 6003;
      name: 'PairStringUnderflow';
      msg: 'Pair string must not be blank';
    },
    {
      code: 6004;
      name: 'PairStringOverflow';
      msg: 'Pair string must be <= 32 bytes';
    },
    {
      code: 6005;
      name: 'SignerIndexOverflow';
      msg: 'Signer out of range';
    },
    {
      code: 6006;
      name: 'InvalidSigner';
      msg: 'Signature verification failed';
    },
    {
      code: 6007;
      name: 'DuplicateSigner';
      msg: 'All signers must be unique';
    },
    {
      code: 6008;
      name: 'InvalidTimestamp';
      msg: 'New timestamp must be greater than previous one';
    },
    {
      code: 6009;
      name: 'Overflow';
      msg: 'Integer overflow';
    },
    {
      code: 6010;
      name: 'Underflow';
      msg: 'Integer underflow';
    },
    {
      code: 6011;
      name: 'InvalidPriceFeed';
      msg: 'Invalid price feed';
    },
    {
      code: 6012;
      name: 'InvalidExpo';
      msg: 'Invalid expo';
    },
  ];
};

export const IDL: Doves = {
  version: '0.1.0',
  name: 'doves',
  instructions: [
    {
      name: 'initialize',
      accounts: [
        {
          name: 'admin',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'feed',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'pair',
          type: {
            array: ['u8', 32],
          },
        },
        {
          name: 'feedSigner',
          type: {
            array: ['u8', 33],
          },
        },
      ],
    },
    {
      name: 'updateWithSigner',
      accounts: [
        {
          name: 'signer',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'feed',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'update',
          type: {
            defined: 'UpdateMessage',
          },
        },
        {
          name: 'raise',
          type: 'bool',
        },
      ],
    },
    {
      name: 'initializeAgPrice',
      accounts: [
        {
          name: 'signer',
          isMut: true,
          isSigner: true,
        },
        {
          name: 'agPriceFeed',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'mint',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'edgeFeed',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'clFeed',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'pythFeed',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'systemProgram',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: 'config',
          type: {
            defined: 'Config',
          },
        },
      ],
    },
    {
      name: 'updateAgPriceFeed',
      accounts: [
        {
          name: 'signer',
          isMut: false,
          isSigner: true,
        },
        {
          name: 'agPriceFeed',
          isMut: true,
          isSigner: false,
        },
        {
          name: 'edgeFeed',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'clFeed',
          isMut: false,
          isSigner: false,
        },
        {
          name: 'pythFeed',
          isMut: false,
          isSigner: false,
        },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: 'agPriceFeed',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'mint',
            type: 'publicKey',
          },
          {
            name: 'edgeFeed',
            type: 'publicKey',
          },
          {
            name: 'clFeed',
            type: 'publicKey',
          },
          {
            name: 'pythFeed',
            type: 'publicKey',
          },
          {
            name: 'pythFeedId',
            type: {
              array: ['u8', 32],
            },
          },
          {
            name: 'price',
            type: 'u64',
          },
          {
            name: 'expo',
            type: 'i8',
          },
          {
            name: 'timestamp',
            type: 'i64',
          },
          {
            name: 'config',
            type: {
              defined: 'Config',
            },
          },
          {
            name: 'bump',
            type: 'u8',
          },
        ],
      },
    },
    {
      name: 'priceFeed',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'pair',
            type: {
              array: ['u8', 32],
            },
          },
          {
            name: 'signer',
            type: {
              array: ['u8', 33],
            },
          },
          {
            name: 'price',
            type: 'u64',
          },
          {
            name: 'expo',
            type: 'i8',
          },
          {
            name: 'timestamp',
            type: 'i64',
          },
          {
            name: 'bump',
            type: 'u8',
          },
        ],
      },
    },
  ],
  types: [
    {
      name: 'Config',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'maxAgPriceAgeSec',
            type: 'u32',
          },
          {
            name: 'maxPriceFeedAgeSec',
            type: 'u32',
          },
          {
            name: 'maxPriceDiffBps',
            type: 'u64',
          },
        ],
      },
    },
    {
      name: 'UpdateMessage',
      type: {
        kind: 'struct',
        fields: [
          {
            name: 'recoveryId',
            type: 'u8',
          },
          {
            name: 'signature',
            type: {
              array: ['u8', 64],
            },
          },
          {
            name: 'price',
            type: 'u64',
          },
          {
            name: 'expo',
            type: 'i8',
          },
          {
            name: 'timestamp',
            type: 'i64',
          },
        ],
      },
    },
  ],
  errors: [
    {
      code: 6000,
      name: 'ThresholdUnderflow',
      msg: 'Threshold must be >0',
    },
    {
      code: 6001,
      name: 'ThresholdOverflow',
      msg: 'Threshold must be <= whitelist length',
    },
    {
      code: 6002,
      name: 'ThresholdNotMet',
      msg: 'Number of signers must be >= threshold',
    },
    {
      code: 6003,
      name: 'PairStringUnderflow',
      msg: 'Pair string must not be blank',
    },
    {
      code: 6004,
      name: 'PairStringOverflow',
      msg: 'Pair string must be <= 32 bytes',
    },
    {
      code: 6005,
      name: 'SignerIndexOverflow',
      msg: 'Signer out of range',
    },
    {
      code: 6006,
      name: 'InvalidSigner',
      msg: 'Signature verification failed',
    },
    {
      code: 6007,
      name: 'DuplicateSigner',
      msg: 'All signers must be unique',
    },
    {
      code: 6008,
      name: 'InvalidTimestamp',
      msg: 'New timestamp must be greater than previous one',
    },
    {
      code: 6009,
      name: 'Overflow',
      msg: 'Integer overflow',
    },
    {
      code: 6010,
      name: 'Underflow',
      msg: 'Integer underflow',
    },
    {
      code: 6011,
      name: 'InvalidPriceFeed',
      msg: 'Invalid price feed',
    },
    {
      code: 6012,
      name: 'InvalidExpo',
      msg: 'Invalid expo',
    },
  ],
};
