import { groupMissingAssets } from '../missingAssets';
import type { MissingAsset } from '../missingAssets';

interface MissingAssetsPanelProps {
  assets: MissingAsset[];
  onClose: () => void;
}

/**
 * Lists the non-fatal missing-content warnings collected from the engine log.
 * Informational only: the map step keeps Play available.
 */
export function MissingAssetsPanel({ assets, onClose }: MissingAssetsPanelProps) {
  const groups = groupMissingAssets(assets);

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Missing assets">
      <div className="settings-panel asset-issues-panel">
        <div className="settings-head">
          <div>
            <div className="eyebrow">Map content</div>
            <h2>
              {assets.length} missing {assets.length === 1 ? 'asset' : 'assets'}
            </h2>
          </div>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
        </div>

        <p className="muted asset-issues-intro">
          The engine skipped these files while loading the map. The demo still plays; missing
          models or textures may be invisible and missing sounds may be silent.
        </p>

        {groups.map(group => (
          <section key={group.kind} className="asset-issues-group">
            <h3>
              {group.label} <span>{group.items.length}</span>
            </h3>
            <ul>
              {group.items.map(item => (
                <li key={item.key}>
                  <code>{item.name}</code>
                  {item.detail ? <span className="muted"> — {item.detail}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="fineprint">
          To load them, add the PK3s that contain these files on the map step before Play.
        </p>
      </div>
    </div>
  );
}
