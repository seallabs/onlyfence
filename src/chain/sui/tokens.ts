import BigNumber from 'bignumber.js';
import { extractTokenSymbol } from '../../utils/index.js';

/**
 * Token entry in the Sui token registry.
 */
interface TokenEntry {
  readonly alias: string;
  readonly coinType: string;
  readonly decimals: number;
}

/**
 * Canonical registry of well-known Sui mainnet tokens.
 * Single source of truth — SUI_TOKEN_MAP and SUI_KNOWN_DECIMALS are derived from this.
 *
 * Aliases are case-sensitive (e.g., "wBTC" and "WBTC" are distinct tokens).
 */
const SUI_TOKEN_REGISTRY: readonly TokenEntry[] = [
  {
    alias: 'AFSUI',
    coinType: '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
    decimals: 9,
  },
  {
    alias: 'ALKIMI',
    coinType: '0x1a8f4bc33f8ef7fbc851f156857aa65d397a6a6fd27a7ac2ca717b51f2fd9489::alkimi::ALKIMI',
    decimals: 9,
  },
  {
    alias: 'ALPHA',
    coinType: '0xfe3afec26c59e874f3c1d60b8203cb3852d2bb2aa415df9548b8d688e6683f93::alpha::ALPHA',
    decimals: 9,
  },
  {
    alias: 'APT',
    coinType: '0x3a5143bb1196e3bcdfab6203d1683ae29edd26294fc8bfeafe4aaa9d2704df37::coin::COIN',
    decimals: 8,
  },
  {
    alias: 'ARTFI',
    coinType: '0x706fa7723231e13e8d37dad56da55c027f3163094aa31c867ca254ba0e0dc79f::artfi::ARTFI',
    decimals: 9,
  },
  {
    alias: 'ATTN',
    coinType: '0x0ef38abcdaaafedd1e2d88929068a3f65b59bf7ee07d7e8f573c71df02d27522::attn::ATTN',
    decimals: 6,
  },
  {
    alias: 'AUR',
    coinType: '0xcc3ac0c9cc23c0bcc31ec566ef4baf6f64adcee83175924030829a3f82270f37::aur::AUR',
    decimals: 9,
  },
  {
    alias: 'AUSD',
    coinType: '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2ab8f6b9c8902f14df2ff2::ausd::AUSD',
    decimals: 6,
  },
  {
    alias: 'AXOL',
    coinType: '0xae00e078a46616bf6e1e6fb673d18dcd2aa31319a07c9bc92f6063363f597b4e::AXOL::AXOL',
    decimals: 9,
  },
  {
    alias: 'BLUB',
    coinType: '0xfa7ac3951fdca92c5200d468d31a365eb03b2be9936fde615e69f0c1274ad3a0::BLUB::BLUB',
    decimals: 2,
  },
  {
    alias: 'BLUE',
    coinType: '0xe1b45a0e641b9955a20aa0ad1c1f4ad86aad8afb07296d4085e349a50e90bdca::blue::BLUE',
    decimals: 9,
  },
  {
    alias: 'BOOST',
    coinType: '0x7bd673d1b980fc2f1c922f91395c325561a675fc2f349c8ffcff7d03bdbeadc8::boost::BOOST',
    decimals: 6,
  },
  {
    alias: 'BUCK',
    coinType: '0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK',
    decimals: 9,
  },
  {
    alias: 'BUT',
    coinType: '0xbc858cb910b9914bee64fff0f9b38855355a040c49155a17b265d9086d256545::but::BUT',
    decimals: 9,
  },
  {
    alias: 'CAPO',
    coinType: '0x6b42e2f4cd5b74c737258b3589a3a09397bb012bda6183f99a87294ecaa8504e::capo::CAPO',
    decimals: 9,
  },
  {
    alias: 'CETUS',
    coinType: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
    decimals: 9,
  },
  {
    alias: 'Chad',
    coinType: '0x4c407edd882f5ba66813856676c486ce4dd16ed7c534d07cf5d50e015c288ab8::chad::CHAD',
    decimals: 6,
  },
  {
    alias: 'cUSDC',
    coinType:
      '0x94e7a8e71830d2b34b3edaa195dc24c45d142584f06fa257b73af753d766e690::celer_usdc_coin::CELER_USDC_COIN',
    decimals: 6,
  },
  {
    alias: 'DAOS',
    coinType: '0xd40cec91f6dca0673b25451fb0d654e62ad13bf6546a32a21ef0c59eba42e71c::daos::DAOS',
    decimals: 6,
  },
  {
    alias: 'DEEP',
    coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    decimals: 6,
  },
  {
    alias: 'DMC',
    coinType: '0x4c981f3ff786cdb9e514da897ab8a953647dae2ace9679e8358eec1e3e8871ac::dmc::DMC',
    decimals: 9,
  },
  {
    alias: 'ETH',
    coinType: '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH',
    decimals: 8,
  },
  {
    alias: 'FDUSD',
    coinType: '0xf16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD',
    decimals: 6,
  },
  {
    alias: 'FLX',
    coinType: '0x6dae8ca14311574fdfe555524ea48558e3d1360d1607d1c7f98af867e3b7976c::flx::FLX',
    decimals: 8,
  },
  {
    alias: 'FUD',
    coinType: '0x76cb819b01abed502bee8a702b4c2d547532c12f25001c9dea795a5e631c26f1::fud::FUD',
    decimals: 5,
  },
  {
    alias: 'HAEDAL',
    coinType: '0x3a304c7feba2d819ea57c3542d68439ca2c386ba02159c740f7b406e592c62ea::haedal::HAEDAL',
    decimals: 9,
  },
  {
    alias: 'haSUI',
    coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    decimals: 9,
  },
  {
    alias: 'haWAL',
    coinType: '0x8b4d553839b219c3fd47608a0cc3d5fcc572cb25d41b7df3833208586a8d2470::hawal::HAWAL',
    decimals: 9,
  },
  {
    alias: 'HIPPO',
    coinType: '0x8993129d72e733985f7f1a00396cbd055bad6f817fee36576ce483c8bbb8b87b::sudeng::SUDENG',
    decimals: 9,
  },
  {
    alias: 'HOPI',
    coinType: '0xc9e497ea76280864615dc97dce4479585ac9b767a014428448df3b8f95310e3f::hopi::HOPI',
    decimals: 6,
  },
  {
    alias: 'Hopper',
    coinType: '0xd7b720a37be0f5540e2499c989cbab660ae6b64f28ec54ceeea68ad3936b8d41::hopper::HOPPER',
    decimals: 6,
  },
  {
    alias: 'HSUI',
    coinType:
      '0x8c47c0bde84b7056520a44f46c56383e714cc9b6a55e919d8736a34ec7ccb533::suicune::SUICUNE',
    decimals: 9,
  },
  {
    alias: 'IKA',
    coinType: '0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA',
    decimals: 9,
  },
  {
    alias: 'iSUI',
    coinType: '0x285b49635f4ed253967a2a4a5f0c5aea2cbd9dd0fc427b4086f3fad7ccef2c29::i_sui::I_SUI',
    decimals: 9,
  },
  {
    alias: 'KDX',
    coinType: '0x3b68324b392cee9cd28eba82df39860b6b220dc89bdd9b21f675d23d6b7416f1::kdx::KDX',
    decimals: 6,
  },
  {
    alias: 'KOTO',
    coinType: '0xa99166e802527eeb5439cbda12b0a02851bf2305d3c96a592b1440014fcb8975::koto::KOTO',
    decimals: 0,
  },
  {
    alias: 'kSUI',
    coinType: '0x41ff228bfd566f0c707173ee6413962a77e3929588d010250e4e76f0d1cc0ad4::ksui::KSUI',
    decimals: 9,
  },
  {
    alias: 'LBTC',
    coinType: '0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC',
    decimals: 8,
  },
  {
    alias: 'LOFI',
    coinType: '0xf22da9a24ad027cccb5f2d496cbe91de953d363513db08a3a734d361c7c17503::LOFI::LOFI',
    decimals: 9,
  },
  {
    alias: 'MAGMA',
    coinType: '0x9f854b3ad20f8161ec0886f15f4a1752bf75d22261556f14cc8d3a1c5d50e529::magma::MAGMA',
    decimals: 9,
  },
  {
    alias: 'MEMEFI',
    coinType: '0x506a6fc25f1c7d52ceb06ea44a3114c9380f8e2029b4356019822f248b49e411::memefi::MEMEFI',
    decimals: 9,
  },
  {
    alias: 'MMT',
    coinType: '0x35169bc93e1fddfcf3a82a9eae726d349689ed59e4b065369af8789fe59f8608::mmt::MMT',
    decimals: 9,
  },
  {
    alias: 'MOON',
    coinType: '0x7b888393d6a552819bb0a7f878183abaf04550bfb9546b20ea586d338210826f::moon::MOON',
    decimals: 6,
  },
  {
    alias: 'MOVE',
    coinType: '0xd9f9b0b4f35276eecd1eea6985bfabe2a2bbd5575f9adb9162ccbdb4ddebde7f::smove::SMOVE',
    decimals: 9,
  },
  {
    alias: 'mUSD',
    coinType: '0xe44df51c0b21a27ab915fa1fe2ca610cd3eaa6d9666fe5e62b988bf7f0bd8722::musd::MUSD',
    decimals: 9,
  },
  {
    alias: 'NAVX',
    coinType: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
    decimals: 9,
  },
  {
    alias: 'NEONET',
    coinType: '0xc1a35b6a9771e6eb69e3b36e921a3a373e6d33e6f863dab6949ed3c2d1228f73::neonet::NEONET',
    decimals: 6,
  },
  {
    alias: 'NS',
    coinType: '0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS',
    decimals: 6,
  },
  {
    alias: 'OINK',
    coinType: '0xaa508ad62918fc483e89a4e8a34d0052a08848c8ebf217e3e6f1a8f3f0a6e33d::oink::OINK',
    decimals: 9,
  },
  {
    alias: 'PDO',
    coinType: '0x4fc3949a4a8fe3ad9c75cec9724ff2b2d8520506b6129c9d8f0fcc2a1e4a8880::pdo::PDO',
    decimals: 8,
  },
  {
    alias: 'PESU',
    coinType: '0xec669967c0c3e396317683e472aada7cc540fd9eb1e717389d6501fe11e547c0::pesu::PESU',
    decimals: 9,
  },
  {
    alias: 'PIGU',
    coinType: '0xfc71274a94f5d9cd1ae6928ecfc9fa910d03eb28258fddeb9842ac3c7b4f3ae6::pigu::PIGU',
    decimals: 5,
  },
  {
    alias: 'PRH',
    coinType: '0x3fb8bdeced0dc4bf830267652ef33fe8fb60b107b3d3b6e5e088dcc0067efa06::prh::PRH',
    decimals: 9,
  },
  {
    alias: 'SAIL',
    coinType: '0x1d4a2bdbc1602a0adaa98194942c220202dcc56bb0a205838dfaa63db0d5497e::SAIL::SAIL',
    decimals: 6,
  },
  {
    alias: 'SCA',
    coinType: '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA',
    decimals: 9,
  },
  {
    alias: 'SCB',
    coinType: '0x9a5502414b5d51d01c8b5641db7436d789fa15a245694b24aa37c25c2a6ce001::scb::SCB',
    decimals: 5,
  },
  {
    alias: 'SCUBA',
    coinType: '0x9e6d6124287360cc110044d1f1d7d04a0954eb317c76cf7927244bef0706b113::SCUBA::SCUBA',
    decimals: 6,
  },
  {
    alias: 'SEND',
    coinType: '0xb45fcfcc2cc07ce0702cc2d229621e046c906ef14d9b25e8e4d25f6e8763fef7::send::SEND',
    decimals: 6,
  },
  {
    alias: 'SHR0',
    coinType: '0x16ab6a14d76a90328a6b04f06b0a0ce952847017023624e0c37bf8aa314c39ba::shr::SHR',
    decimals: 9,
  },
  {
    alias: 'SOL',
    coinType: '0xb7844e289a8410e50fb3ca48d69eb9cf29e27d223ef90353fe1bd8e27ff8f3f8::coin::COIN',
    decimals: 8,
  },
  {
    alias: 'SPAM',
    coinType: '0x30a644c3485ee9b604f52165668895092191fcaf5489a846afa7fc11cdb9b24a::spam::SPAM',
    decimals: 4,
  },
  {
    alias: 'sSUI',
    coinType:
      '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI',
    decimals: 9,
  },
  {
    alias: 'SSWP',
    coinType: '0x361dd589b98e8fcda9a7ee53b85efabef3569d00416640d2faa516e3801d7ffc::TOKEN::TOKEN',
    decimals: 9,
  },
  {
    alias: 'stSUI',
    coinType: '0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI',
    decimals: 9,
  },
  { alias: 'SUI', coinType: '0x2::sui::SUI', decimals: 9 },
  {
    alias: 'SUIA',
    coinType:
      '0x1d58e26e85fbf9ee8596872686da75544342487f95b1773be3c9a49ab1061b19::suia_token::SUIA_TOKEN',
    decimals: 9,
  },
  {
    alias: 'suiUSDe',
    coinType:
      '0x41d587e5336f1c86cad50d38a7136db99333bb9bda91cea4ba69115defeb1402::sui_usde::SUI_USDE',
    decimals: 6,
  },
  {
    alias: 'SUIP',
    coinType: '0xe4239cd951f6c53d9c41e25270d80d31f925ad1655e5ba5b543843d4a66975ee::SUIP::SUIP',
    decimals: 9,
  },
  {
    alias: 'suiUSDT',
    coinType: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
    decimals: 6,
  },
  {
    alias: 'superSUI',
    coinType:
      '0x790f258062909e3a0ffc78b3c53ac2f62d7084c3bab95644bdeb05add7250001::super_sui::SUPER_SUI',
    decimals: 9,
  },
  {
    alias: 'TAKE',
    coinType: '0x76a49ebaf991fa2d4cb6a352af14425d453fe2ba6802b5ed2361b227150b6689::take::TAKE',
    decimals: 9,
  },
  {
    alias: 'TARDI',
    coinType: '0x4cf08813756dfa7519cb480a1a1a3472b5b4ec067592a8bee0f826808d218158::tardi::TARDI',
    decimals: 9,
  },
  {
    alias: 'TATO',
    coinType: '0x04deb377c33bfced1ab81cde96918e2538fe78735777150b0064ccf7df5e1c81::tato::TATO',
    decimals: 9,
  },
  {
    alias: 'TBTC',
    coinType: '0x77045f1b9f811a7a8fb9ebd085b5b0c55c5cb0d1520ff55f7037f89b5da9f5f1::TBTC::TBTC',
    decimals: 8,
  },
  {
    alias: 'Toilet',
    coinType: '0xc5b61b1e1f7f88511c9c0c6f475f823c66cc4e2d39a49beb6777059710be8404::toilet::TOILET',
    decimals: 6,
  },
  {
    alias: 'TURBOS',
    coinType: '0x5d1f47ea69bb0de31c313d7acf89b890dbb8991ea8e03c6c355171f84bb1ba4a::turbos::TURBOS',
    decimals: 9,
  },
  {
    alias: 'TYPUS',
    coinType: '0xf82dc05634970553615eef6112a1ac4fb7bf10272bf6cbe0f80ef44a6c489385::typus::TYPUS',
    decimals: 9,
  },
  {
    alias: 'Uni',
    coinType: '0xaf9e228fd0292e2a27b4859bc57a2f3a9faedb9341b6307c84fef163e44790cc::uni::UNI',
    decimals: 9,
  },
  {
    alias: 'UP',
    coinType: '0x87dfe1248a1dc4ce473bd9cb2937d66cdc6c30fee63f3fe0dbb55c7a09d35dec::up::UP',
    decimals: 6,
  },
  {
    alias: 'US',
    coinType: '0xee962a61432231c2ede6946515beb02290cb516ad087bb06a731e922b2a5f57a::us::US',
    decimals: 9,
  },
  {
    alias: 'USDB',
    coinType: '0xe14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd::usdb::USDB',
    decimals: 6,
  },
  {
    alias: 'USDC',
    coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    decimals: 6,
  },
  {
    alias: 'USDCarb',
    coinType: '0xe32d3ebafa42e6011b87ef1087bbc6053b499bf6f095807b9013aff5a6ecd7bb::coin::COIN',
    decimals: 6,
  },
  {
    alias: 'USDCbnb',
    coinType: '0x909cba62ce96d54de25bec9502de5ca7b4f28901747bbf96b76c2e63ec5f1cba::coin::COIN',
    decimals: 8,
  },
  {
    alias: 'USDCsol',
    coinType: '0xb231fcda8bbddb31f2ef02e6161444aec64a514e2c89279584ac9806ce9cf037::coin::COIN',
    decimals: 6,
  },
  {
    alias: 'USDT',
    coinType:
      '0x94e7a8e71830d2b34b3edaa195dc24c45d142584f06fa257b73af753d766e690::celer_usdt_coin::CELER_USDT_COIN',
    decimals: 6,
  },
  {
    alias: 'USDY',
    coinType: '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
    decimals: 6,
  },
  {
    alias: 'vSUI',
    coinType: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
    decimals: 9,
  },
  {
    alias: 'WAL',
    coinType: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
    decimals: 9,
  },
  {
    alias: 'WBNB',
    coinType: '0xb848cce11ef3a8f62eccea6eb5b35a12c4c2b1ee1af7755d02d7bd6218e8226f::coin::COIN',
    decimals: 8,
  },
  {
    alias: 'wBTC',
    coinType: '0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC',
    decimals: 8,
  },
  {
    alias: 'WBTC',
    coinType: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
    decimals: 8,
  },
  {
    alias: 'WETH',
    coinType: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
    decimals: 8,
  },
  {
    alias: 'wUSDC',
    coinType: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
    decimals: 6,
  },
  {
    alias: 'wUSDT',
    coinType: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
    decimals: 6,
  },
  {
    alias: 'wWAL',
    coinType: '0xb1b0650a8862e30e3f604fd6c5838bc25464b8d3d827fbd58af7cb9685b832bf::wwal::WWAL',
    decimals: 9,
  },
  {
    alias: 'XAUM',
    coinType: '0x9d297676e7a4b771ab023291377b2adfaa4938fb9080b8d12430e4b108b836a9::xaum::XAUM',
    decimals: 9,
  },
  {
    alias: 'xBTC',
    coinType: '0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC',
    decimals: 8,
  },
  {
    alias: 'XO',
    coinType: '0x90f9eb95f62d31fbe2179313547e360db86d88d2399103a94286291b63f469ba::xo::XO',
    decimals: 9,
  },
  {
    alias: 'xSUI',
    coinType: '0x2b6602099970374cf58a2a1b9d96f005fccceb81e92eb059873baf420eb6c717::x_sui::X_SUI',
    decimals: 9,
  },
];

/**
 * Sui mainnet coin type addresses for well-known tokens.
 * Maps alias -> fully-qualified Move coin type.
 *
 * Format: <package_id>::<module>::<struct>
 */
export const SUI_TOKEN_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  SUI_TOKEN_REGISTRY.map(({ alias, coinType }) => [alias, coinType]),
);

/**
 * Reverse mapping from coin type address to alias.
 * Built once at module load from SUI_TOKEN_REGISTRY.
 */
const COIN_TYPE_TO_SYMBOL = new Map<string, string>(
  SUI_TOKEN_REGISTRY.map(({ alias, coinType }) => [coinType, alias]),
);

/**
 * Resolve a coin type address back to its human-readable symbol.
 *
 * @param coinType - Fully-qualified Sui coin type (e.g., "0x2::sui::SUI")
 * @returns The token symbol, or undefined if not in the registry
 */
export function coinTypeToSymbol(coinType: string): string | undefined {
  return COIN_TYPE_TO_SYMBOL.get(coinType);
}

/**
 * Check whether a string is a fully-qualified Move coin type (contains "::").
 */
function isCoinType(input: string): boolean {
  return input.includes('::');
}

/**
 * Resolve a token symbol or coin type to its Sui mainnet coin type address.
 *
 * If the input already contains "::" it is treated as a raw coin type and
 * returned as-is. Otherwise it is looked up by exact alias (case-sensitive).
 *
 * @param symbolOrCoinType - Token alias (e.g., "SUI", "haSUI") or fully-qualified coin type
 * @returns The fully-qualified Sui coin type address
 * @throws if the input is a symbol that is not found in the registry
 */
export function resolveTokenAddress(symbolOrCoinType: string): string {
  if (isCoinType(symbolOrCoinType)) {
    return symbolOrCoinType;
  }

  const address = SUI_TOKEN_MAP[symbolOrCoinType];
  if (address !== undefined) {
    return address;
  }

  throw new Error(
    `Unknown Sui token symbol "${symbolOrCoinType}". Known tokens: ${Object.keys(SUI_TOKEN_MAP).join(', ')}`,
  );
}

/**
 * Known decimals for well-known Sui tokens, keyed by fully-qualified coin type.
 */
export const SUI_KNOWN_DECIMALS: Readonly<Record<string, number>> = Object.fromEntries(
  SUI_TOKEN_REGISTRY.map(({ coinType, decimals }) => [coinType, decimals]),
);

/**
 * Resolve a coin type to its human-readable symbol.
 * Falls back to extracting the last segment of the coin type (e.g., "SUI" from "0x2::sui::SUI").
 */
export function resolveSymbol(coinType: string): string {
  const known = COIN_TYPE_TO_SYMBOL.get(coinType);
  if (known !== undefined) return known;
  return extractTokenSymbol(coinType);
}

/**
 * Get known decimals for a coin type, or undefined if not in the registry.
 */
export function getKnownDecimals(coinType: string): number | undefined {
  return SUI_KNOWN_DECIMALS[coinType];
}

/**
 * Scale a human-readable amount to the token's smallest unit.
 * E.g., scaleToSmallestUnit("100.5", 9) -> "100500000000" (100.5 * 10^9)
 *
 * The caller is responsible for providing the correct decimals value
 * (from remote API, cache, or local fallback). This decouples scaling
 * from decimal resolution.
 *
 * @param humanAmount - Human-readable amount string (e.g., "100.5")
 * @param decimals - Number of decimal places for the token
 * @returns The amount in the token's smallest unit as a string
 * @throws if the amount is not a valid positive number
 */
export function scaleToSmallestUnit(humanAmount: string, decimals: number): string {
  const float = parseFloat(humanAmount);
  if (isNaN(float) || float <= 0) {
    throw new Error(`Invalid amount "${humanAmount}": must be a positive number`);
  }
  const scaled = BigNumber(float)
    .times(10 ** decimals)
    .integerValue(BigNumber.ROUND_FLOOR)
    .toString();
  return scaled;
}

/**
 * Format a raw smallest-unit amount string to a human-readable value
 * given the number of decimal places.
 *
 * E.g., formatAmountWithDecimals("100500000000", 9) -> "100.5"
 *
 * @param raw - Amount in smallest unit as a string
 * @param decimals - Number of decimal places for the token
 * @param maxFracDigits - Optional cap on fractional digits shown
 */
export function formatAmountWithDecimals(
  raw: string,
  decimals: number,
  maxFracDigits?: number,
): string {
  if (decimals === 0) return raw;

  const padded = raw.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals);
  const trimmed = maxFracDigits !== undefined ? frac.slice(0, maxFracDigits) : frac;
  const fracPart = trimmed.replace(/0+$/, '');
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
}

/**
 * Format a smallest-unit amount string to a human-readable value.
 * E.g., formatSmallestUnit("100500000000", "0x2::sui::SUI") -> "100.5"
 *
 * Falls back to the raw string when decimals are unknown.
 */
export function formatSmallestUnit(raw: string, coinType: string): string {
  const decimals = getKnownDecimals(coinType);
  if (decimals === undefined) return raw;
  return formatAmountWithDecimals(raw, decimals);
}

/**
 * Check whether a token alias is known in the Sui token registry (case-sensitive).
 */
export function isKnownToken(symbol: string): boolean {
  return symbol in SUI_TOKEN_MAP;
}
