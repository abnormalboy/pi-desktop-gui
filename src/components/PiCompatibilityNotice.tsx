import type { Environment } from '../../shared/types';
import { compatibilityLabels, compatibilityMessage, PI_INSTALL_COMMAND } from '../../shared/pi-version';
import { CodeBlock } from './conversation/Markdown';

export function PiCompatibilityNotice({ environment }: { environment: Environment }) {
  const { version, compatibility } = environment;
  if (compatibility === 'verified') return null;
  const compatible = compatibility === 'compatible';
  return (
    <div className={compatible ? 'environment-note' : 'compatibility-warning'} aria-label="Pi 版本兼容性">
      <p>
        {compatibilityLabels[compatibility]}：{compatibilityMessage(version, compatibility)}
      </p>
      {!compatible && <CodeBlock>{PI_INSTALL_COMMAND}</CodeBlock>}
    </div>
  );
}
