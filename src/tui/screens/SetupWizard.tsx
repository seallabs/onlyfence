import { Box, Text, useInput } from 'ink';
import { useState, useCallback } from 'react';
import type { ReactElement } from 'react';
import {
  ensureSetupEnvironment,
  generateSetupWallet,
  importSetupWallet,
  saveSetupKeystore,
} from '../../wallet/setup.js';
import type { SetupResult } from '../../wallet/setup.js';
import { toErrorMessage } from '../../utils/index.js';
import { theme } from '../theme.js';
import { TextInput } from '../components/TextInput.js';
import { PasswordInput } from '../components/PasswordInput.js';

type SetupStep =
  | 'choose'
  | 'import_mnemonic'
  | 'show_wallet'
  | 'password'
  | 'confirm_password'
  | 'done'
  | 'error';

interface SetupWizardProps {
  readonly onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps): ReactElement {
  const [step, setStep] = useState<SetupStep>('choose');
  const [walletResult, setWalletResult] = useState<SetupResult | null>(null);
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const doGenerate = useCallback(() => {
    try {
      const db = ensureSetupEnvironment();
      const result = generateSetupWallet(db);
      setWalletResult(result);
      db.close();
      setStep('show_wallet');
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
      setStep('error');
    }
  }, []);

  const doImport = useCallback(() => {
    try {
      const db = ensureSetupEnvironment();
      const result = importSetupWallet(db, mnemonicInput);
      setWalletResult(result);
      db.close();
      setStep('show_wallet');
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
      setStep('error');
    }
  }, [mnemonicInput]);

  const doSaveKeystore = useCallback(() => {
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      setConfirmPassword('');
      setStep('password');
      return;
    }
    if (password.length === 0) {
      setErrorMessage('Password must not be empty.');
      return;
    }
    if (walletResult === null) {
      setErrorMessage('No wallet data available.');
      setStep('error');
      return;
    }
    try {
      saveSetupKeystore(walletResult, password);
      setStep('done');
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
      setStep('error');
    }
  }, [password, confirmPassword, walletResult]);

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
        setStep('password');
      }
    },
    { isActive: step === 'show_wallet' },
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

      {/* Step: show wallet + mnemonic */}
      {step === 'show_wallet' && walletResult !== null && (
        <Box flexDirection="column">
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
                {walletResult.mnemonic}
              </Text>
            </Box>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.body} bold>
              {'Wallet Created'}
            </Text>
            <Text color={theme.eyes}>{`  Chain:   ${walletResult.chain}`}</Text>
            <Text color={theme.eyes}>{`  Address: ${walletResult.address}`}</Text>
            {walletResult.derivationPath !== null && (
              <Text color={theme.eyes}>{`  Path:    ${walletResult.derivationPath}`}</Text>
            )}
          </Box>

          <Box marginTop={1}>
            <Text color={theme.muted}>{'Press Enter to continue to password setup'}</Text>
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
                if (password.length === 0) {
                  setErrorMessage('Password must not be empty.');
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
