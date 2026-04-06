import { Box, Text, useInput } from 'ink';
import { useState, useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import { applyChainConfigDefaults } from '../../config/apply-chain-defaults.js';
import { buildChainModuleRegistry, buildKeyDeriverRegistry } from '../../cli/bootstrap.js';
import type { ChainModuleInfo, CredentialRequirement } from '../../chain/chain-module.js';
import {
  ensureSetupEnvironment,
  generateSetupWallet,
  importSetupWallet,
  mergeKeyIntoKeystore,
  saveSetupKeystore,
} from '../../wallet/setup.js';
import type { SetupResult } from '../../wallet/setup.js';
import type { KeyDeriver } from '../../wallet/key-deriver.js';
import { MIN_PASSWORD_LENGTH } from '../../wallet/keystore.js';
import { initConfig, updateConfigFile } from '../../config/loader.js';
import { toErrorMessage } from '../../utils/index.js';
import { theme } from '../theme.js';
import { TextInput } from '../components/TextInput.js';
import { PasswordInput } from '../components/PasswordInput.js';
import { YesNoPrompt } from '../components/YesNoPrompt.js';

type SetupStep =
  | 'choose'
  | 'import_mnemonic'
  | 'show_wallet'
  | 'chain_credentials'
  | 'password'
  | 'confirm_password'
  | 'update_preference'
  | 'telemetry'
  | 'done'
  | 'error';

interface SetupWizardProps {
  readonly onComplete: () => void;
}

/** All wallet results across chains. */
interface MultiChainWalletResults {
  readonly mnemonic?: string;
  readonly wallets: readonly SetupResult[];
}

export function SetupWizard({ onComplete }: SetupWizardProps): ReactElement {
  const [step, setStep] = useState<SetupStep>('choose');
  const [walletResults, setWalletResults] = useState<MultiChainWalletResults | null>(null);
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Credential collection state
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [currentCredentialInput, setCurrentCredentialInput] = useState('');
  const [credentialIndex, setCredentialIndex] = useState(0);

  const { keyDerivers, chainModuleInfos, allCredentials } = useMemo(() => {
    const keyDeriverRegistry = buildKeyDeriverRegistry();
    const moduleRegistry = buildChainModuleRegistry();
    const chains = keyDeriverRegistry.list();

    const derivers: KeyDeriver[] = [];
    const infos: ChainModuleInfo[] = [];
    const creds: { chain: string; requirement: CredentialRequirement }[] = [];

    for (const chain of chains) {
      derivers.push(keyDeriverRegistry.get(chain));
      if (moduleRegistry.has(chain)) {
        const info = moduleRegistry.getInfo(chain);
        infos.push(info);
        for (const req of info.credentialRequirements) {
          if (req.required) {
            creds.push({ chain, requirement: req });
          }
        }
      }
    }

    return { keyDerivers: derivers, chainModuleInfos: infos, allCredentials: creds };
  }, []);

  const doGenerate = useCallback(() => {
    try {
      const db = ensureSetupEnvironment();
      const wallets: SetupResult[] = [];
      let mnemonic: string | undefined;

      for (const deriver of keyDerivers) {
        const result = generateSetupWallet(db, deriver);
        wallets.push(result);
        if (result.mnemonic !== undefined) mnemonic = result.mnemonic;
      }

      db.close();
      setWalletResults({ mnemonic, wallets });
      setStep('show_wallet');
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
      setStep('error');
    }
  }, [keyDerivers, allCredentials]);

  const doImport = useCallback(() => {
    try {
      const db = ensureSetupEnvironment();
      const wallets: SetupResult[] = [];

      for (const deriver of keyDerivers) {
        const result = importSetupWallet(db, mnemonicInput, deriver);
        wallets.push(result);
      }

      db.close();
      setWalletResults({ mnemonic: mnemonicInput.trim(), wallets });
      setStep('show_wallet');
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
      setStep('error');
    }
  }, [mnemonicInput, keyDerivers]);

  const doSaveKeystore = useCallback(() => {
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      setConfirmPassword('');
      setStep('password');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
      return;
    }
    if (walletResults === null || walletResults.wallets.length === 0) {
      setErrorMessage('No wallet data available.');
      setStep('error');
      return;
    }
    try {
      // Save keystore with all chain keys merged
      const primaryWallet = walletResults.wallets[0];
      if (primaryWallet === undefined) {
        setErrorMessage('No wallet data available.');
        setStep('error');
        return;
      }
      const mergedResult: SetupResult = {
        mnemonic: walletResults.mnemonic,
        address: primaryWallet.address,
        chainId: primaryWallet.chainId,
        derivationPath: primaryWallet.derivationPath,
        privateKeyHex: primaryWallet.privateKeyHex,
      };
      saveSetupKeystore(mergedResult, password);

      // Save additional chain keys into the keystore
      for (let i = 1; i < walletResults.wallets.length; i++) {
        const wallet = walletResults.wallets[i];
        if (wallet === undefined) continue;
        mergeKeyIntoKeystore(wallet.chainId, wallet.privateKeyHex, password);
      }

      setStep('update_preference');
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
      setStep('error');
    }
  }, [password, confirmPassword, walletResults]);

  // --- Step: choose ---
  useInput(
    (input, _key) => {
      if (input === 'g' || input === 'G') {
        doGenerate();
      } else if (input === 'i' || input === 'I') {
        setStep('import_mnemonic');
      }
    },
    { isActive: step === 'choose' },
  );

  // --- Step: show_wallet (press Enter to continue) ---
  useInput(
    (_input, key) => {
      if (key.return) {
        // If there are credentials to collect, go there; otherwise password
        if (allCredentials.length > 0) {
          setCredentialIndex(0);
          setCurrentCredentialInput('');
          setStep('chain_credentials');
        } else {
          setStep('password');
        }
      }
    },
    { isActive: step === 'show_wallet' },
  );

  // --- Step: chain_credentials ---
  const currentCredential = allCredentials[credentialIndex];

  const handleCredentialSubmit = useCallback(() => {
    if (currentCredentialInput.trim() === '') {
      setErrorMessage('This credential is required.');
      return;
    }

    const cred = allCredentials[credentialIndex];
    if (cred === undefined) return;

    const key = `${cred.chain}.${cred.requirement.name}`;
    setCredentialValues((prev) => ({ ...prev, [key]: currentCredentialInput.trim() }));
    setCurrentCredentialInput('');
    setErrorMessage('');

    if (credentialIndex + 1 < allCredentials.length) {
      setCredentialIndex(credentialIndex + 1);
    } else {
      setStep('password');
    }
  }, [currentCredentialInput, credentialIndex, allCredentials]);

  /** Save a config preference and advance to the next step. */
  const saveConfigPreference = useCallback(
    (key: string, value: Record<string, unknown>, nextStep: SetupStep): void => {
      try {
        try {
          initConfig();
        } catch {
          // Config already exists — expected.
        }
        updateConfigFile((raw) => {
          raw[key] = value;

          for (const info of chainModuleInfos) {
            const chainCreds: Record<string, string> = {};
            for (const [credKey, credValue] of Object.entries(credentialValues)) {
              const [chainName, ...rest] = credKey.split('.');
              if (chainName === info.chain) {
                chainCreds[rest.join('.')] = credValue;
              }
            }

            applyChainConfigDefaults(
              raw,
              info.chain,
              info.defaultChainConfig,
              Object.keys(chainCreds).length > 0 ? chainCreds : undefined,
            );
          }
        });
        setStep(nextStep);
      } catch (err: unknown) {
        setErrorMessage(toErrorMessage(err));
        setStep('error');
      }
    },
    [chainModuleInfos, credentialValues],
  );

  // --- Step: update_preference (y/n) ---
  useInput(
    (input) => {
      if (input === 'y' || input === 'Y') {
        saveConfigPreference('update', { auto_install: true }, 'telemetry');
      } else if (input === 'n' || input === 'N') {
        saveConfigPreference('update', { auto_install: false }, 'telemetry');
      }
    },
    { isActive: step === 'update_preference' },
  );

  // --- Step: telemetry (y/n) ---
  useInput(
    (input) => {
      if (input === 'y' || input === 'Y') {
        saveConfigPreference('telemetry', { enabled: true }, 'done');
      } else if (input === 'n' || input === 'N') {
        saveConfigPreference('telemetry', { enabled: false }, 'done');
      }
    },
    { isActive: step === 'telemetry' },
  );

  // --- Step: done (press Enter to continue) ---
  useInput(
    (_input, key) => {
      if (key.return) {
        onComplete();
      }
    },
    { isActive: step === 'done' },
  );

  // --- Step: error (press Enter to retry) ---
  useInput(
    (_input, key) => {
      if (key.return) {
        setErrorMessage('');
        setStep('choose');
      }
    },
    { isActive: step === 'error' },
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Title */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.highlight} bold>
          {'OnlyFence Setup'}
        </Text>
        <Text color={theme.muted}>{'─'.repeat(50)}</Text>
      </Box>

      {/* Step: choose */}
      {step === 'choose' && (
        <Box flexDirection="column">
          <Text color={theme.eyes}>{"Welcome! Let's set up your wallet."}</Text>
          <Box marginTop={1}>
            <Text color={theme.body}>{'  Press '}</Text>
            <Text color={theme.highlight} bold>
              {'g'}
            </Text>
            <Text color={theme.body}>{' to generate a new wallet (recommended)'}</Text>
          </Box>
          <Box>
            <Text color={theme.body}>{'  Press '}</Text>
            <Text color={theme.highlight} bold>
              {'i'}
            </Text>
            <Text color={theme.body}>{' to import an existing mnemonic'}</Text>
          </Box>
          {errorMessage.length > 0 && (
            <Box marginTop={1}>
              <Text color={theme.error}>{errorMessage}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Step: import mnemonic */}
      {step === 'import_mnemonic' && (
        <Box flexDirection="column">
          <Text color={theme.eyes}>{'Enter your BIP-39 mnemonic phrase:'}</Text>
          <Box marginTop={1}>
            <Text color={theme.body}>{'> '}</Text>
            <TextInput
              value={mnemonicInput}
              onChange={setMnemonicInput}
              onSubmit={doImport}
              onCancel={() => {
                setMnemonicInput('');
                setStep('choose');
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted}>{'Enter to confirm, Esc to go back'}</Text>
          </Box>
        </Box>
      )}

      {/* Step: show wallet + mnemonic (multi-chain) */}
      {step === 'show_wallet' && walletResults !== null && (
        <Box flexDirection="column">
          {walletResults.mnemonic !== undefined && (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={theme.warning}
              paddingX={2}
              paddingY={1}
            >
              <Text color={theme.warning} bold>
                {'IMPORTANT: Back up your mnemonic phrase!'}
              </Text>
              <Text color={theme.warning}>{'Keep this safe. You will NOT see it again.'}</Text>
              <Box marginTop={1}>
                <Text color={theme.eyes} bold>
                  {walletResults.mnemonic}
                </Text>
              </Box>
            </Box>
          )}

          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.body} bold>
              {'Wallets Created'}
            </Text>
            {walletResults.wallets.map((wallet, i) => (
              <Box key={wallet.chainId} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
                <Text color={theme.eyes}>{`  Chain:   ${wallet.chainId}`}</Text>
                <Text color={theme.eyes}>{`  Address: ${wallet.address}`}</Text>
                {wallet.derivationPath !== null && (
                  <Text color={theme.eyes}>{`  Path:    ${wallet.derivationPath}`}</Text>
                )}
              </Box>
            ))}
          </Box>

          <Box marginTop={1}>
            <Text color={theme.muted}>
              {allCredentials.length > 0
                ? 'Press Enter to continue to API key setup'
                : 'Press Enter to continue to password setup'}
            </Text>
          </Box>
        </Box>
      )}

      {/* Step: chain_credentials */}
      {step === 'chain_credentials' && currentCredential !== undefined && (
        <Box flexDirection="column">
          <Text color={theme.eyes} bold>
            {`${currentCredential.chain.charAt(0).toUpperCase() + currentCredential.chain.slice(1)} Configuration`}
          </Text>
          <Box marginTop={1}>
            <Text color={theme.body}>{currentCredential.requirement.description}</Text>
          </Box>
          {errorMessage.length > 0 && (
            <Box marginTop={1}>
              <Text color={theme.error}>{errorMessage}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color={theme.body}>{`${currentCredential.requirement.name}: `}</Text>
            <TextInput
              value={currentCredentialInput}
              onChange={setCurrentCredentialInput}
              onSubmit={handleCredentialSubmit}
              onCancel={() => {
                setCurrentCredentialInput('');
                if (credentialIndex > 0) {
                  setCredentialIndex(credentialIndex - 1);
                } else {
                  setStep('show_wallet');
                }
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted}>
              {`(${credentialIndex + 1}/${allCredentials.length}) Enter to confirm`}
            </Text>
          </Box>
        </Box>
      )}

      {/* Step: password */}
      {step === 'password' && (
        <Box flexDirection="column">
          <Text color={theme.eyes}>{'Enter a password to encrypt your keystore:'}</Text>
          {errorMessage.length > 0 && (
            <Box marginTop={1}>
              <Text color={theme.error}>{errorMessage}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color={theme.body}>{'Password:  '}</Text>
            <PasswordInput
              value={password}
              onChange={setPassword}
              onSubmit={() => {
                if (password.length < MIN_PASSWORD_LENGTH) {
                  setErrorMessage(
                    `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
                  );
                  return;
                }
                setErrorMessage('');
                setStep('confirm_password');
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted}>{'Enter to confirm'}</Text>
          </Box>
        </Box>
      )}

      {/* Step: confirm password */}
      {step === 'confirm_password' && (
        <Box flexDirection="column">
          <Text color={theme.eyes}>{'Confirm your password:'}</Text>
          <Box marginTop={1}>
            <Text color={theme.body}>{'Password:  '}</Text>
            <Text color={theme.eyes}>{'*'.repeat(password.length)}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.body}>{'Confirm:   '}</Text>
            <PasswordInput
              value={confirmPassword}
              onChange={setConfirmPassword}
              onSubmit={doSaveKeystore}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted}>{'Enter to confirm'}</Text>
          </Box>
        </Box>
      )}

      {/* Step: update_preference */}
      {step === 'update_preference' && (
        <YesNoPrompt
          title="Enable automatic updates?"
          descriptions={['OnlyFence will check for new versions and install them automatically.']}
          yesLabel="to enable auto-update"
          noLabel="to be asked before each update (default)"
          hint="You can change this later in config.toml [update]"
          errorMessage={errorMessage}
        />
      )}

      {/* Step: telemetry */}
      {step === 'telemetry' && (
        <YesNoPrompt
          title="Anonymous Error Reporting"
          descriptions={[
            'OnlyFence can report anonymous crash data to help improve the tool.',
            'No wallet addresses, keys, balances, or trade data will be sent.',
          ]}
          yesLabel="to enable anonymous error reporting"
          noLabel="to keep it disabled (default)"
          hint="You can change this later in config.toml [telemetry]"
          errorMessage={errorMessage}
        />
      )}

      {/* Step: done */}
      {step === 'done' && (
        <Box flexDirection="column">
          <Text color={theme.success} bold>
            {'Setup complete!'}
          </Text>
          <Text color={theme.eyes}>{'Keystore encrypted and saved.'}</Text>
          <Text color={theme.eyes}>{'Configuration initialized.'}</Text>
          <Box marginTop={1}>
            <Text color={theme.muted}>{'Press Enter to continue to the dashboard'}</Text>
          </Box>
        </Box>
      )}

      {/* Step: error */}
      {step === 'error' && (
        <Box flexDirection="column">
          <Text color={theme.error} bold>
            {'Setup Error'}
          </Text>
          <Text color={theme.error}>{errorMessage}</Text>
          <Box marginTop={1}>
            <Text color={theme.muted}>{'Press Enter to retry'}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
