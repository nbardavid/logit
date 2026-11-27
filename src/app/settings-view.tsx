import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  ImageIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { BoatTarget, Project } from '../model/catalog'

import {
  changedRows,
  effectiveValue,
  type Row,
  rowById,
  type Section,
  SECTIONS,
  type SettingValue,
} from '../settings/schema'
import { AccountsPane, ProjectAccounts } from './accounts-pane'
import { playSettingsSound } from './attention'
import { BOAT_UNSAVED, ProjectBoat } from './boat-pane'
import { previewCleanup } from './cleanup-effect'
import { ContextMenu, type MenuState } from './context-menu'
import { GROUND_SETTING } from './ground'
import { GroundSwatch, ToneField } from './ground-picker'
import { noteGroundSetting } from './ground-store'
import { noteLoaderSetting } from './loader-choice'
import { isImageIcon, readPicture, SquareCrop } from './project-image'
import {
  currentProjects,
  nameTone,
  noteProjects,
  PROJECT_ICONS,
  PROJECT_TONES,
  useProjects,
} from './project-look'
import { EDIT_BACKGROUND_PROMPT, NEW_BACKGROUND_PROMPT } from './prompts'
import {
  BackgroundTiles,
  LoaderPicker,
  Segmented,
  SelectMenu,
  Slider,
  Stepper,
  Switch,
  TextField,
} from './settings-controls'
import {
  currentPane,
  paneProject,
  PANES,
  projectPane,
  setPane,
  stepPane,
  usePane,
  usePaneId,
} from './settings-pane'
import { ProjectAvatar } from './sidebar'
import { DEFAULT_FONT, noteTerminalSetting } from './terminal-font'
import { devBuild, type Update } from './update-button'
import { deleteScene, noteWallpaperSetting, useWallpaperState } from './wallpaper'
import {
  NO_WALLPAPER,
  pickedScene,
  type SceneFile,
  WALLPAPER_BLUR_SETTING,
  WALLPAPER_SETTING,
  WALLPAPER_TEXT_BLUR_SETTING,
  WALLPAPER_VEIL_SETTING,
} from './wallpapers'

type Stored = Record<string, SettingValue>

/** A group: its label over a card of rows. */
const groupTitle = 'text-label mb-2 px-1 text-xs font-medium'
const cardClass = 'bg-background divide-y overflow-hidden rounded-lg border'
const rowClass = 'flex min-h-11 items-center justify-between gap-6 px-4 py-2.5'
const rowHelp = 'text-muted-foreground text-xs'
/** Under a card: what the whole group means, said once. */
const groupFoot = 'text-faint mt-2 px-1 text-xs'
const fieldError = 'text-critical-ink text-xs wrap-anywhere'

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** What the second click says it will do, as the restart bar says it. */
export function restartWarning(chats: number, terminals: number): string {
  const clauses = [
    chats > 0 && `pauses ${count(chats, 'working chat')}`,
    terminals > 0 && `closes ${count(terminals, 'terminal')}`,
  ].filter(Boolean)
  return clauses.length === 0 ? 'Click again to restart' : `Click again: ${clauses.join(', ')}`
}

/** What Restore defaults says: once at rest, then what the second click resets. */
export function restoreLabel(changed: number, armed: boolean): string {
  if (!armed) return 'Restore defaults'
  return `Restore ${count(changed, 'setting')}?`
}

/** What Settings › About says under the version, and whether it says it as an error. */
export function updateStatus(update: Update, dev: boolean): { text: string; failed: boolean } {
  if (dev) return { failed: false, text: 'This dev build never updates itself.' }
  if (update.installing)
    return { failed: false, text: 'Downloading; the window restarts when done.' }
  if (update.error !== null) return { failed: true, text: update.error }
  if (update.version !== null)
    return {
      failed: false,
      text: `${update.version} is out. Updating restarts the window; chats and terminals keep running.`,
    }
  if (update.checking) return { failed: false, text: 'Checking for updates…' }
  if (update.checkError !== null) return { failed: true, text: update.checkError }
  if (update.checkedAt !== null) return { failed: false, text: 'Up to date.' }
  return {
    failed: false,
    text: 'Checks at launch, when you come back to the window, and every hour.',
  }
}

/** A label and its one line of help, left of a control. */
function Label({ help, label }: { label: ReactNode; help?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm">{label}</span>
      {help !== undefined && <span className={rowHelp}>{help}</span>}
    </div>
  )
}

/** Slides a row open or shut on its height, so the card grows instead of jumping. */
function Reveal({ children, open }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-180 ease-in-out motion-reduce:transition-[opacity]',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0'
      )}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/** Appearance › Background: the tiles (a right-click changes or deletes a scene), and the blurs. */
function Background({
  onAsk,
  stored,
  write,
}: {
  stored: Stored
  write: (id: string, value: SettingValue | null) => void
  /** Opens a chat on this prompt, over Settings' close. */
  onAsk: (prompt: string) => void
}) {
  const { dir, error, picked, scenes } = useWallpaperState()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const value = pickedScene(scenes, picked)?.id ?? NO_WALLPAPER

  const sceneMenu = (scene: SceneFile, e: MouseEvent) =>
    setMenu({
      items: [
        { label: 'Change with Claude…', run: () => onAsk(EDIT_BACKGROUND_PROMPT(dir, scene.id)) },
        'separator',
        {
          confirm: { button: 'Delete', text: `Delete ${scene.name}? Its file goes for good.` },
          danger: true,
          label: 'Delete',
          run: () => deleteScene(scene.id),
        },
      ],
      x: e.clientX,
      y: e.clientY,
    })

  // No divide-y: the rows below slide in with their own top line.
  return (
    <div className="bg-background overflow-hidden rounded-lg border">
      <div className="px-4 pt-4 pb-3.5">
        <BackgroundTiles
          scenes={scenes}
          value={value}
          onChange={(id) => write(WALLPAPER_SETTING, id)}
          onMenu={sceneMenu}
          onAsk={dir === '' ? undefined : () => onAsk(NEW_BACKGROUND_PROMPT(dir))}
        />
        {error !== null && (
          <span className={cn(fieldError, 'animate-in fade-in mt-3 block')}>
            {`Couldn't read the backgrounds folder: ${error}`}
          </span>
        )}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      <Reveal open={value !== NO_WALLPAPER}>
        {[WALLPAPER_BLUR_SETTING, WALLPAPER_TEXT_BLUR_SETTING, WALLPAPER_VEIL_SETTING].map((id) => {
          const row = rowById(id)
          if (row.kind !== 'number') return null
          const unit = row.unit ?? ''
          return (
            <div key={id} className={cn(rowClass, 'border-t')}>
              <Label label={row.label} />
              <Slider
                label={row.label}
                value={Number(effectiveValue(row, stored[id]))}
                min={row.min}
                max={row.max}
                step={row.step}
                format={(v) => (v === 0 ? 'Off' : `${v}${unit}`)}
                onCommit={(v) => write(id, v)}
              />
            </div>
          )
        })}
      </Reveal>
    </div>
  )
}

/** One setting's control, by its kind. */
function Control({
  onChange,
  row,
  stored,
  value,
}: {
  row: Row
  value: SettingValue
  stored: Stored
  onChange: (v: SettingValue) => void
}) {
  switch (row.kind) {
    case 'toggle':
      return <Switch label={row.label} checked={value === true} onChange={onChange} />
    case 'text':
      return (
        <TextField
          label={row.label}
          value={String(value)}
          placeholder={row.placeholder}
          mono={row.mono}
          onChange={onChange}
        />
      )
    case 'number': {
      const n = Number(value)
      if (row.control === 'stepper')
        return (
          <Stepper
            label={row.label}
            value={n}
            min={row.min}
            max={row.max}
            step={row.step}
            onChange={onChange}
          />
        )
      // Volume means nothing without a sound.
      const silent = row.id === 'notifications.volume' && stored['notifications.sound'] === 'Off'
      return (
        <span className="flex" data-tip={silent ? 'Pick a sound first' : undefined}>
          <Slider
            label={row.label}
            value={n}
            min={row.min}
            max={row.max}
            step={row.step}
            disabled={silent}
            format={(v) => (row.zeroOff === true && v === 0 ? 'Off' : `${v}${row.unit ?? ''}`)}
            onCommit={onChange}
          />
        </span>
      )
    }
    case 'select': {
      const props = { label: row.label, onChange, options: row.options, value: String(value) }
      if (row.control === 'segmented') return <Segmented {...props} />
      if (row.control === 'loader' || row.control === 'dots')
        return <LoaderPicker {...props} dots={row.control === 'dots'} />
      return <SelectMenu {...props} />
    }
  }
}

/** A pane made of the schema's groups. */
function SectionPane({
  onAsk,
  page,
  section,
  stored,
  write,
}: {
  onAsk: (prompt: string) => void
  section: Section
  stored: Stored
  write: (id: string, value: SettingValue | null) => void
  page: HTMLElement | null
}) {
  const change = (row: Row, v: SettingValue) => {
    write(row.id, v)
    // Picking an effect (again) shows it, over this page.
    if (row.id === 'ui.cleanupEffect') void previewCleanup(String(v), page)
    // Picking a sound or a volume plays it.
    if (row.id.startsWith('notifications.')) playSettingsSound({ ...stored, [row.id]: v })
  }
  return (
    <>
      {section.groups.map((group) => (
        <section key={group.label}>
          <h2 className={groupTitle}>{group.label}</h2>
          {group.rows.some((r) => r.id === WALLPAPER_SETTING) ? (
            <Background stored={stored} write={write} onAsk={onAsk} />
          ) : (
            <div className={cardClass}>
              {group.rows.map((row) => {
                const value = effectiveValue(row, stored[row.id])
                return (
                  <div key={row.id}>
                    <div className={rowClass}>
                      <Label label={row.label} help={row.help} />
                      <div className="flex flex-none items-center gap-1.5">
                        {row.id === 'ui.cleanupEffect' && value !== 'None' && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Play the clean up effect"
                            data-tip="Play it"
                            onClick={() => void previewCleanup(String(value), page)}
                          >
                            <PlayIcon />
                          </Button>
                        )}
                        {row.id === GROUND_SETTING ? (
                          <GroundSwatch />
                        ) : (
                          <Control
                            row={row}
                            value={value}
                            stored={stored}
                            onChange={(v) => change(row, v)}
                          />
                        )}
                      </div>
                    </div>
                    {row.id === 'terminal.fontFamily' && <FontSample family={String(value)} />}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ))}
    </>
  )
}

/** A line set in the terminal's font, under the font's row. */
function FontSample({ family }: { family: string }) {
  const named = family.trim().replaceAll('"', '')
  return (
    <div className="px-4 pb-3">
      <div
        className="bg-chrome text-muted-foreground truncate rounded-md px-3 py-2 font-mono text-mono"
        style={{ fontFamily: named === '' ? DEFAULT_FONT : `"${named}", ${DEFAULT_FONT}` }}
      >
        ~/logit <span className="text-foreground">main</span> ❯ ls -la src
      </div>
    </div>
  )
}

/** Restarting the host closes its terminals, so it asks twice; chats resume from transcripts. */
function HostPane({
  chats,
  onRestart,
  terminals,
}: {
  onRestart: () => Promise<void>
  chats: number
  terminals: number
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  let label = 'Restart…'
  if (busy) label = 'Restarting…'
  else if (armed) label = restartWarning(chats, terminals)
  const running = [count(chats, 'working chat'), count(terminals, 'terminal')].join(', ')
  return (
    <section>
      <h2 className={groupTitle}>Chats and terminals</h2>
      <div className={cardClass}>
        <div className={rowClass}>
          <Label
            label="Running"
            help={error === null ? running : <span className={fieldError}>{error}</span>}
          />
          <div className="flex flex-none" onMouseLeave={() => setArmed(false)}>
            <Button
              type="button"
              size="sm"
              variant={armed ? 'destructive' : 'outline'}
              disabled={busy}
              onBlur={() => setArmed(false)}
              onClick={() => {
                if (!armed) {
                  setArmed(true)
                  return
                }
                setBusy(true)
                void onRestart().catch((error_: unknown) => {
                  setBusy(false)
                  setArmed(false)
                  setError(String(error_).replace(/^Error: /, ''))
                })
              }}
            >
              {/* The label cross-fades in place as it arms. */}
              <span key={label} className="animate-in fade-in duration-120 ease-out">
                {label}
              </span>
            </Button>
          </div>
        </div>
      </div>
      <p className={groupFoot}>
        They keep running when the window closes. Chats resume after a restart; terminals
        don&apos;t.
      </p>
    </section>
  )
}

/** The version and its updates, the settings file, the source. */
function AboutPane({ path, update }: { update: Update; path: string }) {
  const [version, setVersion] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void getVersion().then(setVersion, () => {})
  }, [])
  const status = updateStatus(update, devBuild)
  let label = 'Check for updates'
  if (update.installing) label = 'Updating…'
  else if (update.version !== null) label = `Update to ${update.version}`
  else if (update.checking) label = 'Checking…'
  return (
    <section>
      <h2 className={groupTitle}>logit</h2>
      <div className={cardClass}>
        <div className={rowClass}>
          <Label
            label={version === null ? 'Version' : `Version ${version}`}
            help={
              // The line cross-fades as the state moves on.
              <span
                key={status.text}
                className={cn(
                  status.failed && 'text-critical-ink',
                  'animate-in fade-in duration-160 ease-out'
                )}
              >
                {status.text}
              </span>
            }
          />
          <Button
            type="button"
            size="sm"
            variant={update.version === null ? 'outline' : 'default'}
            disabled={devBuild || update.checking || update.installing}
            onClick={update.version === null ? update.check : update.install}
          >
            <span key={label} className="animate-in fade-in duration-120 ease-out">
              {label}
            </span>
          </Button>
        </div>
        <div className={rowClass}>
          <Label
            label="Settings file"
            help={
              <span className="block truncate font-mono" title={path}>
                {path}
              </span>
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy the path"
            data-tip={copied ? 'Copied' : 'Copy the path'}
            onClick={() => {
              void navigator.clipboard.writeText(path).then(() => setCopied(true))
            }}
            onMouseLeave={() => setCopied(false)}
          >
            <CopyIcon />
          </Button>
        </div>
        <div className={rowClass}>
          <Label label="Source" />
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => void openUrl('https://github.com/nbardavid/logit').catch(() => {})}
          >
            nbardavid/logit
            <ArrowUpRightIcon />
          </Button>
        </div>
      </div>
      <p className={groupFoot}>MIT. Started from BrimVeyn/aimux.</p>
    </section>
  )
}

export interface ProjectLook {
  name: string
  color: string
  icon: string
}

/** The folder's own name: what an emptied name falls back to. */
const folderName = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path

const swatch =
  'grid size-7 place-items-center rounded-full outline-2 outline-offset-2 outline-transparent transition-[outline-color,transform] duration-120 ease-out hover:scale-110 aria-checked:outline-foreground focus-visible:outline-[color-mix(in_srgb,var(--tan)_70%,transparent)] motion-reduce:hover:scale-100'
const iconTile =
  'text-muted-foreground hover:bg-hover hover:text-foreground aria-checked:bg-active aria-checked:text-foreground grid size-8 place-items-center rounded-md text-xs font-bold transition-[background-color,color] duration-120 ease-out outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--tan)_70%,transparent)]'

/** Every hue round the Custom dot until a colour of its own is picked. */
const RAINBOW =
  'conic-gradient(from 90deg, #c2554d, #b8913a, #6f9a4a, #3f8f8a, #4a6fb0, #7a5aa8, #b0508a, #c2554d)'

/**
 * The last colour dot: a colour of the user's own, picked on the window colour's field. The
 * sidebar folder and avatars follow the drag; the release keeps it.
 */
function CustomTone({
  onCommit,
  project,
  value,
}: {
  project: Project
  /** The custom colour in use, or '' while it is one of the ten or the name's. */
  value: string
  onCommit: (hex: string) => void
}) {
  const preview = (color: string) =>
    noteProjects(currentProjects().map((p) => (p.id === project.id ? { ...p, color } : p)))
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            role="radio"
            aria-checked={value !== ''}
            aria-label="Custom colour"
            data-tip="Custom…"
            className={cn(swatch, 'text-white')}
            style={{ background: value === '' ? RAINBOW : value }}
          >
            {value === '' ? (
              <PlusIcon
                className="size-3.5 drop-shadow-[0_0_1px_rgb(0_0_0/0.4)]"
                strokeWidth={2.5}
              />
            ) : (
              <CheckIcon className="size-3.5" strokeWidth={2.5} />
            )}
          </button>
        }
      />
      <PopoverContent align="start" className="w-[290px] p-3">
        <ToneField
          value={value === '' ? (project.color ?? nameTone(project.name)) : value}
          onLive={preview}
          onCommit={onCommit}
        />
      </PopoverContent>
    </Popover>
  )
}

/** Settings › one project: its name, its tone and icon, its folder and setup script. */
function ProjectPane({
  onSetAccounts,
  onSetBoat,
  onUpdate,
  project,
}: {
  project: Project
  onUpdate: (look: ProjectLook) => void
  onSetAccounts: (accounts: string[]) => void
  onSetBoat: (boat: BoatTarget | null) => void
}) {
  const [copied, setCopied] = useState(false)
  // A picture that isn't square, being cut square below the icons.
  const [cropping, setCropping] = useState<string | null>(null)
  const [pictureError, setPictureError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const stopCropping = useCallback(() => setCropping(null), [])
  const cropBox = useRef<HTMLDivElement>(null)
  // The cropper comes into view once it has slid open, under the icons.
  const opened = cropping !== null
  useEffect(() => {
    if (!opened) return
    const timer = setTimeout(
      () => cropBox.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
      180
    )
    return () => clearTimeout(timer)
  }, [opened])
  const look: ProjectLook = {
    color: project.color ?? '',
    icon: project.icon ?? '',
    name: project.name,
  }
  const set = (change: Partial<ProjectLook>) => onUpdate({ ...look, ...change })
  const initial = project.name.slice(0, 1).toUpperCase()
  // A colour of its own, not one of the ten: the Custom dot holds it.
  const custom = look.color !== '' && !PROJECT_TONES.some((t) => t.id === look.color)
  const pick = (file: File) => {
    setPictureError(null)
    if (!file.type.startsWith('image/')) return setPictureError('Pick a picture: PNG, JPEG, SVG…')
    readPicture(file).then(
      (read) => ('square' in read ? set({ icon: read.square }) : setCropping(read.crop)),
      () => setPictureError("Couldn't read this picture.")
    )
  }
  return (
    <>
      <section>
        <h2 className={groupTitle}>Project</h2>
        <div className={cardClass}>
          <div className={rowClass}>
            <Label label="Name" help="In the sidebar, ⌘P and the composer." />
            <TextField
              label="Name"
              value={project.name}
              placeholder={folderName(project.path)}
              onChange={(name) => set({ name })}
            />
          </div>
          <div className={rowClass}>
            <Label
              label="Folder"
              help={
                <span className="block truncate font-mono" title={project.path}>
                  {project.path}
                </span>
              }
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy the path"
              data-tip={copied ? 'Copied' : 'Copy the path'}
              onClick={() => {
                void navigator.clipboard.writeText(project.path).then(() => setCopied(true))
              }}
              onMouseLeave={() => setCopied(false)}
            >
              <CopyIcon />
            </Button>
          </div>
        </div>
        <p className={groupFoot}>An empty name gives the folder&apos;s back.</p>
      </section>
      <section>
        <h2 className={groupTitle}>Look</h2>
        <div className={cardClass}>
          <div className="flex flex-col gap-3 px-4 py-3.5">
            <Label label="Colour" help="Its avatar and its folder in the sidebar." />
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Colour">
              <button
                type="button"
                role="radio"
                aria-checked={look.color === ''}
                aria-label="From its name"
                data-tip="From its name"
                className={cn(swatch, 'text-2xs font-bold text-white')}
                style={{ background: nameTone(project.name) }}
                onClick={() => set({ color: '' })}
              >
                A
              </button>
              {PROJECT_TONES.map((tone) => (
                <button
                  type="button"
                  key={tone.id}
                  role="radio"
                  aria-checked={look.color === tone.id}
                  aria-label={tone.label}
                  data-tip={tone.label}
                  className={cn(swatch, 'text-white')}
                  style={{ background: tone.id }}
                  onClick={() => set({ color: tone.id })}
                >
                  {look.color === tone.id && <CheckIcon className="size-3.5" strokeWidth={2.5} />}
                </button>
              ))}
              <CustomTone
                project={project}
                value={custom ? look.color : ''}
                onCommit={(color) => set({ color })}
              />
            </div>
          </div>
          <div
            className="flex flex-col gap-3 px-4 py-3.5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file !== undefined) pick(file)
            }}
          >
            <Label
              label="Icon"
              help="Its avatar; the initial by default. Drop a picture here, or pick one."
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file !== undefined) pick(file)
              }}
            />
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Icon">
              <button
                type="button"
                role="radio"
                aria-checked={look.icon === ''}
                aria-label="Initial"
                data-tip="Initial"
                className={iconTile}
                onClick={() => set({ icon: '' })}
              >
                {initial}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={isImageIcon(look.icon)}
                aria-label="Picture…"
                data-tip={isImageIcon(look.icon) ? 'Another picture…' : 'Picture…'}
                className={iconTile}
                onClick={() => fileInput.current?.click()}
              >
                {isImageIcon(look.icon) ? (
                  <img src={look.icon} alt="" className="size-5 rounded-[4px] object-cover" />
                ) : (
                  <ImageIcon className="size-4" />
                )}
              </button>
              {Object.entries(PROJECT_ICONS).map(([id, Icon]) => (
                <button
                  type="button"
                  key={id}
                  role="radio"
                  aria-checked={look.icon === id}
                  aria-label={id}
                  className={iconTile}
                  onClick={() => set({ icon: id })}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
            {pictureError !== null && (
              <span className={cn(fieldError, 'animate-in fade-in')}>{pictureError}</span>
            )}
          </div>
          <Reveal open={cropping !== null}>
            <div className="border-t px-4 py-3.5" ref={cropBox}>
              {cropping !== null && (
                <SquareCrop
                  src={cropping}
                  onCancel={stopCropping}
                  onDone={(icon) => {
                    setCropping(null)
                    set({ icon })
                  }}
                />
              )}
            </div>
          </Reveal>
        </div>
      </section>
      <ProjectAccounts picked={project.accounts ?? []} onChange={onSetAccounts} />
      <ProjectBoat value={project.boat} onChange={onSetBoat} />
      <section>
        <h2 className={groupTitle}>Workspaces</h2>
        <div className={cardClass}>
          <div className={rowClass}>
            <Label
              label="Setup script"
              help="Runs in each new workspace: dependencies, .env, caches."
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void invoke('edit_setup_script', { projectId: project.id }).catch(() => {})
              }
            >
              Edit
              <ArrowUpRightIcon />
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}

/** Puts a pane's settings back to their defaults; asks twice. */
function RestoreDefaults({ changed, onRestore }: { changed: number; onRestore: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (changed === 0) setArmed(false)
  }, [changed])
  return (
    <div
      className={cn(
        'flex justify-end transition-opacity duration-160 ease-out',
        changed === 0 && 'pointer-events-none opacity-0'
      )}
      aria-hidden={changed === 0}
      onMouseLeave={() => setArmed(false)}
    >
      <Button
        variant="ghost"
        size="sm"
        tabIndex={changed === 0 ? -1 : 0}
        className={cn(armed && 'text-critical-ink hover:text-critical-ink')}
        onBlur={() => setArmed(false)}
        onClick={() => {
          if (!armed) return setArmed(true)
          setArmed(false)
          onRestore()
        }}
      >
        <RotateCcwIcon />
        <span key={String(armed)} className="animate-in fade-in duration-120 ease-out">
          {restoreLabel(changed, armed)}
        </span>
      </Button>
    </div>
  )
}

/** Writes straight into settings.json; a new workspace reads it when it is made. */
export function SettingsView({
  chats,
  onAsk,
  onClose,
  onRestartHost,
  onSetProjectAccounts,
  onSetProjectBoat,
  onUpdateProject,
  terminals,
  update,
}: {
  onClose: () => void
  /** Settings › a project: the Claude accounts its chats run as. */
  onSetProjectAccounts: (id: string, accounts: string[]) => Promise<void>
  /** Settings › a project: whether its workspaces may run on Boat, and who pays. */
  onSetProjectBoat: (id: string, boat: BoatTarget | null) => Promise<void>
  /** Settings › Projects: a project's name, tone or icon changed. */
  onUpdateProject: (id: string, look: ProjectLook) => void
  /** Opens a chat on this prompt in the workspace on screen: Settings closes for it. */
  onAsk: (prompt: string) => void
  /** The app's update, which About checks and installs. */
  update: Update
  onRestartHost: () => Promise<void>
  /** Chats in a turn, which restarting the background process would pause. */
  chats: number
  /** Terminals that restarting the background process would close. */
  terminals: number
}) {
  const [stored, setStored] = useState<Stored | null>(null)
  const [path, setPath] = useState('settings.json')
  const [error, setError] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const pane = usePane()
  const paneId = usePaneId()
  const projects = useProjects()
  const projectId = paneProject(paneId)
  const project = projects.find((p) => p.id === projectId)

  useEffect(() => {
    void invoke<{ path: string; settings: Stored }>('read_settings').then(
      (read) => {
        setPath(read.path)
        setStored(read.settings)
      },
      () => {
        setError("Couldn't load settings.json. Changes won't be saved.")
        setStored({})
      }
    )
  }, [])

  // A new pane starts at its top.
  useEffect(() => {
    page.current?.scrollTo({ top: 0 })
  }, [paneId])

  const write = (id: string, value: SettingValue | null) => {
    invoke('write_setting', { id, value })
      .then(() => {
        noteLoaderSetting(id, value)
        noteWallpaperSetting(id, value)
        noteTerminalSetting(id, value)
        noteGroundSetting(id, value)
        setStored((state) => {
          const next = { ...state }
          if (value === null) delete next[id]
          else next[id] = value
          return next
        })
      })
      .catch((error_: unknown) => setError(`Couldn't save: ${String(error_)}`))
  }

  const section = SECTIONS.find((s) => s.id === pane.id)
  const changed = section !== undefined && stored !== null ? changedRows(section, stored) : []

  // A window over the app, not a page: an opaque sheet on a faint veil, so it reads as
  // anchored, while the chat around it stays clear enough to see a background picked.
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        overlayClassName="bg-foreground/6"
        className="top-1/2 h-[min(640px,calc(100%-64px))] w-[min(880px,calc(100%-48px))] -translate-y-1/2 flex-row"
      >
        <SettingsNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 flex-none items-center justify-between gap-4 pr-4 pl-8">
            {project === undefined ? (
              <DialogTitle className="text-base">{pane.label}</DialogTitle>
            ) : (
              <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
                <ProjectAvatar name={project.name} />
                <span className="truncate">{project.name}</span>
              </DialogTitle>
            )}
            {section !== undefined && project === undefined && (
              <RestoreDefaults
                changed={changed.length}
                onRestore={() => {
                  for (const row of changed) write(row.id, null)
                }}
              />
            )}
          </div>
          <div ref={page} className="min-h-0 flex-1 overflow-auto px-8 pt-2 pb-8">
            {/* The pane fades in and rises a hair; the old one leaves at once. */}
            <div
              key={paneId}
              className="animate-in fade-in slide-in-from-bottom-1 flex flex-col gap-6 duration-160 ease-out"
            >
              {error !== null && <div className={cn(fieldError, 'px-1')}>{error}</div>}
              {project !== undefined && (
                <ProjectPane
                  project={project}
                  onUpdate={(look) => onUpdateProject(project.id, look)}
                  onSetAccounts={(accounts) =>
                    void onSetProjectAccounts(project.id, accounts).catch(() =>
                      setError("Couldn't save the project's accounts.")
                    )
                  }
                  onSetBoat={(boat) =>
                    void onSetProjectBoat(project.id, boat).catch(() => setError(BOAT_UNSAVED))
                  }
                />
              )}
              {project === undefined && section !== undefined && stored !== null && (
                <SectionPane
                  section={section}
                  stored={stored}
                  write={write}
                  page={page.current}
                  onAsk={onAsk}
                />
              )}
              {project === undefined && pane.id === 'accounts' && <AccountsPane />}
              {project === undefined && pane.id === 'host' && (
                <HostPane chats={chats} terminals={terminals} onRestart={onRestartHost} />
              )}
              {project === undefined && pane.id === 'about' && (
                <AboutPane update={update} path={path} />
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const navTab =
  'hover:bg-hover text-muted-foreground aria-selected:bg-active aria-selected:text-foreground flex h-8 flex-none items-center gap-2.5 rounded-md px-2.5 text-sm whitespace-nowrap transition-[background-color,color] duration-120 outline-none'

/** The sections, then one per project, down the window's left side. ↑/↓ step through them,
 * as ⌃Tab does. */
function SettingsNav() {
  const paneId = usePaneId()
  const projects = useProjects()
  const tab = (id: string, icon: ReactNode, label: string) => (
    <button
      type="button"
      key={id}
      role="tab"
      data-pane={id}
      aria-selected={paneId === id}
      tabIndex={paneId === id ? 0 : -1}
      className={navTab}
      onClick={() => setPane(id)}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </button>
  )
  return (
    <div
      className="bg-well border-border flex w-[200px] flex-none flex-col gap-0.5 overflow-y-auto border-r p-2 pt-3"
      role="tablist"
      aria-orientation="vertical"
      aria-label="Settings"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        stepPane(e.key === 'ArrowDown' ? 1 : -1)
        e.currentTarget
          .querySelector<HTMLElement>(`[data-pane="${CSS.escape(currentPane())}"]`)
          ?.focus()
      }}
    >
      <span className="text-label px-2.5 pb-2 text-xs font-medium">Settings</span>
      {PANES.map(({ icon: Icon, id, label }) =>
        tab(
          id,
          <Icon
            className={cn('size-4 shrink-0', paneId === id ? 'text-foreground' : 'text-faint')}
          />,
          label
        )
      )}
      {projects.length > 0 && (
        <span className="text-label px-2.5 pt-4 pb-2 text-xs font-medium">Projects</span>
      )}
      {projects.map((p) =>
        tab(projectPane(p.id), <ProjectAvatar name={p.name} size="sm" className="mx-px" />, p.name)
      )}
    </div>
  )
}
