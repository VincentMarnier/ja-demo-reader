import type { ChangeEvent, RefObject } from 'react';
import type { AssetSelection, DemoSummary, LocalFile, StageProgress, ValidationResult } from '../types';
import type { MissingAsset } from '../missingAssets';
import type { EngineMode } from '../engine/host';
import { DemoSummaryView } from './DemoSummaryView';
import { ScriptFlagsPanel } from './ScriptFlagsPanel';

type WizardStep = 'assets' | 'demo' | 'map';

interface LauncherProps {
  step: WizardStep;
  assetSelection: AssetSelection | null;
  assetValidation: ValidationResult | null;
  demoFile: LocalFile | null;
  demoWarning: string | null;
  mapName: string;
  mapMissing: boolean;
  mapError: string | null;
  missingAssets: MissingAsset[];
  addedPk3s: string[];
  addingPk3s: boolean;
  summary: DemoSummary | null;
  engineMode: EngineMode | null;
  enginePreparing: boolean;
  preparingDemo: boolean;
  engineActive: boolean;
  onReleaseMemory: () => void;
  engineProgress: StageProgress | null;
  savedHandle: FileSystemDirectoryHandle | null;
  busy: boolean;
  onPickAssets: () => void;
  onSaved: () => void;
  onAssetsFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onFolderFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  assetInputRef: RefObject<HTMLInputElement | null>;
  folderInputRef: RefObject<HTMLInputElement | null>;
  demoInputRef: RefObject<HTMLInputElement | null>;
  mapInputRef: RefObject<HTMLInputElement | null>;
  onDemoSelect: (name: string) => void;
  onDemoFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onCheckMap: () => void;
  onMapFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onShowMissingAssets: () => void;
  /** Start/seek to a flagged moment and follow that player (-1 = demo POV). */
  onWatchScript: (time: number, followNum: number) => void;
  /** Start the demo at a chosen absolute demo time, in ms. */
  onPlayFrom: (timeMs: number) => void;
  onPlay: () => void;
  onStep: (step: WizardStep) => void;
}

export function Launcher(props: LauncherProps) {
  const { assetSelection, assetValidation, demoFile, mapName, mapMissing } = props;
  const assetErrors = assetValidation?.errors ?? [];

  return (
    <div className="launcher-layer">
      <div className="panel launcher">
        <div className="steps" aria-label="Steps">
          <span className={props.step === 'assets' ? 'step active' : 'step'}>1 · Assets</span>
          <span className={props.step === 'demo' ? 'step active' : 'step'}>2 · Demo</span>
          <span className={props.step === 'map' ? 'step active' : 'step'}>3 · Map</span>
        </div>

        {props.step === 'assets' ? (
          <>
            <div className="eyebrow">Jedi Academy · multiplayer demos</div>
            <h1>Select your <span className="accent">game assets</span></h1>
            <p className="lede">
              Choose the <code>GameData</code> folder from a retail Jedi Academy install (or its
              <code>base</code> folder). Files stay on this device.
            </p>
            <div className="launcher-actions">
              <button className="primary" onClick={props.onPickAssets} disabled={props.busy}>
                Select GameData folder
              </button>
              <button className="secondary" onClick={() => props.assetInputRef.current?.click()} disabled={props.busy}>
                Choose assets instead
              </button>
              {props.savedHandle ? (
                <button className="ghost" onClick={props.onSaved} disabled={props.busy}>Use last folder</button>
              ) : null}
            </div>

            {assetSelection ? (
              <div className="selection">
                <div className="facts">
                  <div><span className="fact-value">{assetValidation?.assets.length ?? 0}/4</span><span className="fact-label">PK3s</span></div>
                  <div><span className="fact-value">{assetValidation?.demos.length ?? 0}</span><span className="fact-label">demos found</span></div>
                  <div><span className="fact-value">{assetErrors.length ? '!' : 'OK'}</span><span className="fact-label">assets</span></div>
                </div>
                {assetErrors.length ? (
                  <ul className="alerts error">{assetErrors.map(e => <li key={e}>{e}</li>)}</ul>
                ) : (
                  <button className="primary wide" onClick={() => props.onStep('demo')}>Next: select demo</button>
                )}
                {assetValidation && assetValidation.warnings.length ? (
                  <ul className="alerts warn">
                    {assetValidation.warnings.map(w => <li key={w}>{w}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {props.step === 'demo' ? (
          <>
            <div className="eyebrow">Step 2 of 3</div>
            <h1>Select a <span className="accent">demo</span></h1>
            <p className="lede">
              Demos are protocol-26 files ending in <code>.dm_26</code>. We will read the first
              gamestate to find the map before starting.
            </p>

            {assetSelection && assetSelection.demos.length > 0 ? (
              <label className="field">
                <span>Demo found in the selected folder</span>
                <select
                  value={demoFile?.name ?? ''}
                  onChange={e => props.onDemoSelect(e.target.value)}
                >
                  {assetSelection.demos.map(demo => (
                    <option key={demo.name} value={demo.name}>{demo.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="muted">No demo was found in the selected folder.</p>
            )}

            <div className="launcher-actions" style={{ marginTop: 12 }}>
              <button className="secondary" onClick={() => props.demoInputRef.current?.click()}>
                {demoFile ? 'Choose another .dm_26' : 'Choose .dm_26 file'}
              </button>
              <button className="ghost" onClick={() => props.onStep('assets')}>Back to assets</button>
            </div>

            {demoFile ? (
              <div className="selected-file">
                <strong>{demoFile.name}</strong>
                <span className="muted searchable">{Math.round(demoFile.file.size / 1024)} KB</span>
              </div>
            ) : null}

            {props.demoWarning ? <ul className="alerts warn"><li>{props.demoWarning}</li></ul> : null}

            <button
              className="primary wide"
              onClick={props.onCheckMap}
              disabled={props.busy || !demoFile || assetErrors.length > 0}
            >
              {props.busy ? 'Staging and parsing…' : 'Check map'}
            </button>
            <p className="fineprint">
              Game data is mounted read-only for this session; the demo is parsed by the engine's
              own gamestate reader.
            </p>
          </>
        ) : null}

        {props.step === 'map' ? (
          <>
            <div className="eyebrow">Step 3 of 3</div>
            <h1>{!mapName ? 'Map not recognised' : mapMissing ? 'Map missing' : 'Map ready'}</h1>
            <p className="lede">
              {mapName
                ? <>The demo was recorded on <code>{mapName}</code>.</>
                : 'The demo map could not be read from the first gamestate.'}
            </p>

            {mapName ? (
              <div className="map-check">
                <span className="fact-label">Map</span>
                <strong>{mapName}</strong>
                <span className={mapMissing ? 'status bad' : 'status good'}>
                  {mapMissing ? 'not in selected game data' : 'found'}
                </span>
              </div>
            ) : null}

            {props.busy ? (
              <p className="scan-status">
                <span className="spinner" aria-hidden="true" />
                <span>Scanning the demo timeline… this can take a moment.</span>
              </p>
            ) : null}

            {props.mapError ? <ul className="alerts error"><li>{props.mapError}</li></ul> : null}

            {props.missingAssets.length ? (
              <div className="asset-issues-note" role="status">
                <strong>
                  {props.missingAssets.length} missing map{' '}
                  {props.missingAssets.length === 1 ? 'asset' : 'assets'}
                </strong>
                <span>Playback continues; some models, textures or sounds may be missing.</span>
                <button type="button" className="text-link" onClick={props.onShowMissingAssets}>
                  View details
                </button>
              </div>
            ) : null}

            <DemoSummaryView
              summary={props.summary}
              onPlayFrom={props.onPlayFrom}
              busy={props.busy || props.addingPk3s}
              canPlay={!!mapName && !mapMissing}
            />

            {props.summary ? (
              <ScriptFlagsPanel
                summary={props.summary}
                onWatch={props.onWatchScript}
                busy={props.busy}
              />
            ) : null}

            {props.preparingDemo ? (
              <p className="scan-status">
                <span className="spinner" aria-hidden="true" />
                <span>Preparing the player in the background. Play will continue when it is ready.</span>
              </p>
            ) : null}

            {!mapName && !mapMissing ? (
              <div className="row">
                <button className="primary" onClick={() => props.onStep('demo')}>Choose another demo</button>
              </div>
            ) : mapMissing ? (
              <div className="selection">
                <p className="muted">
                  Add the PK3 that contains <code>maps/{mapName || '…'}.bsp</code>. Community maps
                  can also need models or textures from another map PK3; select those here too.
                  They are added to the session's writable engine data; nothing is written to your
                  GameData folder.
                </p>
                <button
                  className="primary"
                  onClick={() => props.mapInputRef.current?.click()}
                  disabled={props.addingPk3s || props.busy}
                >
                  {props.addingPk3s ? 'Adding game data…' : 'Add map / dependency .pk3'}
                </button>
              </div>
            ) : (
              <>
                <div className="row">
                  <button className="primary" onClick={props.onPlay} disabled={!mapName || props.busy || props.addingPk3s}>
                    {props.busy ? 'Preparing timeline…' : 'Play demo'}
                  </button>
                  <button
                    className="ghost"
                    onClick={() => props.mapInputRef.current?.click()}
                    disabled={props.addingPk3s || props.busy || props.preparingDemo}
                    title={
                      props.preparingDemo
                        ? 'Wait for the background map load to finish before changing the game data.'
                        : undefined
                    }
                  >
                    {props.addingPk3s ? 'Adding game data…' : 'Add extra .pk3'}
                  </button>
                  <button className="ghost" onClick={() => props.onStep('demo')}>Choose another demo</button>
                </div>
                <p className="fineprint">
                  Missing props or textures? Add the other PK3s this map uses before Play.
                </p>
              </>
            )}

            {props.addedPk3s.length ? (
              <p className="fineprint">
                Added this session: <code>{props.addedPk3s.join(', ')}</code>
              </p>
            ) : null}

            {props.engineActive ? (
              <div className="row">
                <button
                  className="ghost"
                  onClick={props.onReleaseMemory}
                  disabled={props.preparingDemo}
                  title={props.preparingDemo ? 'The background load is still running.' : undefined}
                >
                  Release memory
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {props.enginePreparing ? (
          <p className="scan-status">
            <span className="spinner" aria-hidden="true" />
            <span>
              {props.engineProgress && props.engineProgress.total > 0 && props.engineProgress.loaded >= props.engineProgress.total
                ? 'Starting the wasm engine…'
                : `Preparing the wasm engine… ${
                    props.engineProgress && props.engineProgress.total > 0
                      ? Math.round((props.engineProgress.loaded / props.engineProgress.total) * 100) + '%'
                      : ''
                  }`}
            </span>
          </p>
        ) : null}

        {props.engineMode === 'main-thread' ? (
          <p className="fineprint degraded-notice">
            Compatibility mode: this browser cannot run the engine in a worker. Game data is copied
            into memory, so the tab uses more RAM and the first load is slower. Chrome, Edge or Brave
            with WebGL2 get the fast path.
          </p>
        ) : null}

        <input
          ref={props.assetInputRef}
          type="file"
          multiple
          accept=".pk3,.dm_26"
          className="hidden-input"
          onChange={props.onAssetsFileInput}
        />
        <input
          ref={props.folderInputRef}
          type="file"
          multiple
          className="hidden-input"
          onChange={props.onFolderFileInput}
          {...({ webkitdirectory: '' } as Record<string, string>)}
        />
        <input
          ref={props.demoInputRef}
          type="file"
          accept=".dm_26"
          className="hidden-input"
          onChange={props.onDemoFileInput}
        />
        <input
          ref={props.mapInputRef}
          type="file"
          multiple
          accept=".pk3"
          className="hidden-input"
          onChange={props.onMapFileInput}
        />

        <p className="fineprint">
          Retail <code>assets0..3.pk3</code> and a protocol-26 demo are required. Game data stays on
          this device.
        </p>
      </div>
    </div>
  );
}
