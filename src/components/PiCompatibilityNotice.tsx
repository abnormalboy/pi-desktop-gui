import type { Environment } from '../../shared/types';
import { compatibilityLabels, compatibilityMessage, PI_INSTALL_COMMAND } from '../../shared/pi-version';
import { CodeBlock } from './conversation/Markdown';

export function PiCompatibilityNotice({ environment }: { environment: Environment }) {
  const { version, compatibility, supported } = environment;
  if (compatibility !== 'unknown') return null;
  return (
    <div className={supported ? 'environment-note' : 'compatibility-warning'} aria-label="Pi 版本兼容性">
      <p>
        {compatibilityLabels[compatibility]}：{compatibilityMessage(version, compatibility)}
      </p>
      {!supported && <CodeBlock>{PI_INSTALL_COMMAND}</CodeBlock>}
    </div>
  );
}
