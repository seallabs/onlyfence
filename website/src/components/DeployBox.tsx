import {useState, type ReactNode} from 'react';

export default function DeployBox(): ReactNode {
  const [copied, setCopied] = useState(false);
  const command = 'curl -fsSL https://raw.githubusercontent.com/seallabs/onlyfence/main/install.sh | sh';

  const handleCopy = (): void => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="of-deploy-container">
      <div className="of-deploy-title">Ready to deploy?</div>
      <div className="of-deploy-subtitle">One command. Takes about 30 seconds. No account required.</div>
      <div className="of-deploy-bar">
        <div className="of-deploy-label">INSTALL</div>
        <div className="of-deploy-code">
          <code>{command}</code>
        </div>
        <button className="of-deploy-copy" onClick={handleCopy}>
          {copied ? 'COPIED' : 'COPY'}
        </button>
      </div>
    </div>
  );
}
