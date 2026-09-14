import { Suspense, lazy, useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useAnchoredTriggerRect } from '../hooks/useAnchoredTriggerRect'
import { SETTINGS_DEFAULT_MODEL_ID } from '../hooks/useSettingHighlight'
import { settingsPath } from '../components/settingsPath'
import { agentOrDefaultLabel } from '../utils/agentLabel'
import { toApiDecision } from '../utils/approvalDecision'
import { isHiddenInvisibleAssistantRow } from '../utils/invisibleText'
import { useAppSelector, store, type AppDispatch } from '../store'
import { useConfirm } from '../components/ConfirmDialog'
import {
  switchSlot, createSlot, forkSlot, promoteSlot, setPendingInput, openActivityPanel, openActivityToTab, selectSubagent, clearFollowupCard, dismissFollowupItem, requestSlotReveal, mcpAppKey,
} from '../store/chatSlice'
import { slotIsRemoteBound } from '../store/dashboardSlice'
import { api } from '../api/client'
import { safeSetSessionItem } from '../utils/safeStorage'
import { EmptyState, Btn, Input } from '../components/ui'
import { ChatTranscriptSkeleton } from '../components/ChatTranscriptSkeleton'
import SnipOverlay from '../components/SnipOverlay'
import CollapsibleToolGroup from './chat/CollapsibleToolGroup'
import { RowDisclosureProvider } from './chat/rowDisclosure'
import { MeasureFarm } from '../hooks/virtualizer/MeasureFarm'
import { useScrollManager } from './chat/useScrollManager'
import { searchScopeIsLimited } from './chat/pagination'
import { ChatHeaderMenu } from './chat/ChatHeaderMenu'
import {
  KnowledgeBubbleChip, msgIdentityKey,
} from './chat/ChatPageMessageContent'
import { useChatPageTranscriptEarlyController } from './chat/useChatPageTranscriptController'
import { useChatPageSessionController } from './chat/useChatPageSessionController'
import { useChatPageResourcesController } from './chat/useChatPageResourcesController'
import { useComposerDraftLifecycle, useComposerDraftStores, useStagedDraftPersistence } from './chat/page/composerDrafts'
import { useComposerStaging, useStagedFolderRefs } from './chat/page/composerStaging'
import { useFileMentionActions } from './chat/page/composerFileMentions'
import { useChatEventBridges, useColdFileTabHydration } from './chat/page/eventBridges'
import { useChatPageEnvironment, usePageFlags } from './chat/page/pageEnvironment'
import { useActiveSlotState } from './chat/page/activeSlotState'
import { useComposerDraftState, ComposerDraftSync, useComposerIntakeRefs, useMainComposerHandoff, useComposerVoiceHost } from './chat/page/composerHost'
import { useModelPickerModels, useNewSessionPicks, useSessionChoices } from './chat/page/sessionPicks'
import { useSteerDelivery, useRefusedPress, REFUSED_PRESS_TITLE_KEYS, useRegenerate } from './chat/page/turnActions'
import { useTranscriptScrollRefs, useTranscriptPaging } from './chat/page/transcriptPaging'
import { useRunInTerminalConfig, useAppPanelReveal } from './chat/page/panelTabs'
import { useComposerSend } from './chat/page/composerSend'
import { useFollowupCardActions, useFollowupStarts } from './chat/page/followupCardActions'
import { usePaneLayoutState, usePanelLayout } from './chat/page/paneLayout'
import { usePageSelectionActions, useMessageActions } from './chat/page/messageActions'
import { useTranscriptPins } from './chat/page/transcriptPins'
import { useTranscriptRendering } from './chat/page/transcriptRendering'
import { useSessionsDrawer, DRAWER_UNCOVERED_PX } from './chat/page/sessionsDrawer'
import { RunInTerminalScope } from '../components/runInTerminalScope'
import { useWelcomeState } from './chat/page/welcomeState'
import { useSessionRosters } from './chat/page/sessionRosters'
import { useAppLaunchIntake, useAutoSendIntake, useErrorHandoffIntake, usePendingInputIntake } from './chat/page/launchIntake'
import { useFollowUpChips } from './chat/page/followUpChips'
import { useComposerSessionControls, useSessionControlChips } from './chat/page/sessionControls'
import { useComposerChips } from './chat/page/composerChips'
import { useTurnRecovery } from './chat/page/turnRecovery'
import { useComposerAboveBand } from './chat/page/composerDock'
import { DOCK_CLEARANCE_PX } from './chat/composerDockMetrics'
import { useStableRowKeys, useTranscriptRows } from './chat/page/transcriptRows'
import { useBusyTurnControls } from './chat/page/busyTurnControls'
import { slotBusySteer } from '../components/chat-input/busySend'
import { useSessionAutomation } from './chat/page/sessionAutomation'
import { useTranscriptJumps } from './chat/page/transcriptJumps'
import ChatPaneNotices from './chat/page/ChatPaneNotices'
import MobileTopBar from './chat/page/MobileTopBar'
import EarlierMessagesBar from './chat/EarlierMessagesBar'
import TranscriptScrollShell, { useTranscriptWidth } from './chat/TranscriptScrollShell'
import TurnNavigationMinimap from './chat/TurnNavigationMinimap'
import { SELECTION_INERT_ATTR } from './chat/useSelectionInertOverlays'
import { extractPromptFromToken, extractSlackContextFromToken } from '../utils/tokenPrompt'


/**
 * Height of the transcript's tail spacer, in px.
 *
 * This plus the scroller's own dock clearance is the gap between the last line of
 * the transcript and the top of the composer dock when the reader is at the
 * bottom. It is a px value and not `vh` on purpose: as `2vh` the clearance tracked
 * the viewport and the margin was one pixel at 844px tall, so every shorter
 * viewport — i.e. every phone — landed the last line under the dock.
 */
const TRANSCRIPT_TAIL_SPACER_PX = 16

// No arbitrary cap on pinned-jump page loads: the loop terminates when the
// target message is found OR history is exhausted (!slotHasMore / null result).
// The `cancelled` flag in the useEffect cleanup and the loadOlderMessages null
// sentinel prevent infinite loops.  A ref tracks loads for diagnostics only.
// Canonical home is utils/navIntent (shared with the popout nav-intent
// applier); re-exported here for this page's historical importers.
export { PREFILL_STORAGE_KEY } from '../utils/navIntent'
export { shouldAutoFillOlder } from './chat/page/transcriptPaging'
import { PREFILL_STORAGE_KEY, writePrefill } from '../utils/navIntent'
import WelcomeView from '../components/WelcomeView'
import { MemoryModeChip } from '../components/MemoryModeChip'
import { claimAppAutoOpen } from '../hooks/usePanelTabs'
import { legacyCodexEffort } from '../hooks/useInteractiveModels'
import { isUnpinnedModel, jevRouteShownModel } from '../lib/jevRoute'
import { useListboxKeyboard } from '../hooks/useListboxKeyboard'
import AgentDropdownList, { DefaultAgentRow, ManageAgentsFooter, defaultWriteKind, isCrewmateChat } from '../components/AgentDropdownList'
import ProjectPicker from '../components/ProjectPicker'
import { ProjectAwsProfileSection } from '../components/ProjectAwsProfile'
import InboundLinkChip from '../components/InboundLinkChip'
import ModelEffortDropdown from '../components/ModelEffortDropdown'

import ChatInput from '../components/ChatInput'
import { useStableCallbackProps } from './chat/useStableCallbackProps'
import SessionControlHost from '../components/SessionControlHost'
import ErrorNotice from '../components/ErrorNotice'
import ChatDropOverlay from '../components/ChatDropOverlay'
import SessionGridView from '../components/SessionGridView'
import SessionTabStrip from '../components/SessionTabStrip'
import { mcpAppTabTitle } from '../lib/mcpAppSrcdoc'
import { pinIsWithheld } from '../lib/model'
import { slotApprovalMode } from '../utils/slotApprovalMode'
import { isComposerSendHeld, useComposerSendHeld } from '../utils/composerSendHolds'
import FollowUpCard from '../components/FollowUpCard'
import PendingQuestionCard from '../components/PendingQuestionCard'
import SessionPulseSurveyCard from '../components/SessionPulseSurveyCard'
import type { FollowupItem } from '../store/chatSlice'

import FlyingQuote from '../components/FlyingQuote'
import SearchHighlightContext from '../hooks/SearchHighlightContext'
import SearchBar from '../components/SearchBar'
import SearchResultsList from '../components/SearchResultsList'
import QueueStack, { SubagentDeliveryProgress } from '../components/QueueStack'
import { Composer } from '../chat-core/composer/Composer'
import { ChatFooter, PinnedPrompt } from './chat'
import { pinCandidateKey } from './chat/usePinnedPrompt'
import { JiraHostsCtx } from '../lib/jiraHosts'
import { ClosedSessionCtx, SidebarFolderCtx } from '../components/markdown/contexts'
import SessionTitleControl from './chat/SessionTitleControl'
import SubagentProgressBar from './chat/SubagentProgressBar'
import TaskProgressBar from './chat/TaskProgressBar'
import SidePanel from './chat/SidePanel'
import ChatSidebar from './ChatSidebar'
import { SIDEBAR_MAX } from './chat/sidebarWidth'
import OverlayDrawer from '../components/OverlayDrawer'
import { loadChatConfig, CONTENT_WIDTH, type ChatConfig } from './chat/ChatSettings'
import { scaleContentWidth } from './chat/contentWidth'
import SessionFlyout, { TOGGLE_RECT } from './chat/SessionFlyout'
import { KnowledgePicker } from './chat/KnowledgePicker'
import { MessageSquare, Undo2, Columns2, ExternalLink } from 'lucide-react'
import { EdgeFade, JumpToBottomButton } from '../app-sdk/ChatScrollChrome'
import { PanelLeftSolid, PanelLeftLight } from '../components/icons/panels'
import { SidePanelDockHost, SidePanelGlyph } from '../components/SidePanelGlyph'

import SlotTagPopover from '../components/SlotTagPopover'
import { TagPopoverProvider } from '../hooks/useTagPopover'

import { AnimatePresence, motion } from 'framer-motion'
import DetailPanel from '../components/DetailPanel'


import { shouldMountSidePanel, isSidePanelHidden, SIDE_PANEL_DOCK_TRANSITION } from './chat/sidePanelMount'
import type { ParsedSubagentCompletion } from './chat/subagentCompletion'
import TurnBlock from './chat/TurnBlock'
import Clickable from '../components/Clickable'
import { useLabelTip } from '../components/InstantTip'
import WorkflowProgressBar from './chat/WorkflowProgressBar'
import { tryQuickSend } from '../lib/quickSend'
import { sessionTitleRoster } from '../utils/sessionRoster'
import { errMessage } from '../utils/thunkError'
import { showTranscriptForkFailure } from '../utils/forkFailure'
// Only a crew session mounts the window, so its code loads on first open.
const CrewChatWindow = lazy(() => import('./chat/crew-window/CrewChatWindow'))
// Eager: holds the window's isolation guards until its chunk arrives.
import CrewWindowGuard from './chat/crew-window/CrewWindowGuard'


import { i18nT } from '../i18n/t'
import { uiLocation } from '../uiLocations/uiLocation'
import { GuideRevealScope } from '../guide/GuideRevealScope'
import { fmtDateFields } from '../i18n/format'
import { fetchDashboardConfig } from '../api/dashboardConfigQuery'

/**
 * Horizontal room the chat pane reclaims (negative margin) while the desktop
 * sessions sidebar is collapsed: the gap the open panel kept between itself and
 * the pane. Every pane-space offset that clears the stationary toggle adds it.
 */
const COLLAPSED_PANE_RECLAIM_PX = 8
/**
 * Leading clearance for the open-session strip while the desktop sessions
 * sidebar is collapsed. The pane's reclaimed margin moves the toggle's
 * container-space right edge (x + size) that much farther into the strip; the
 * final 4px keeps the first tab visibly separate from the control.
 */
const COLLAPSED_SESSION_TABS_INSET = TOGGLE_RECT.x + TOGGLE_RECT.size + COLLAPSED_PANE_RECLAIM_PX + 4
/**
 * Human-readable reason from a rejected thunk. `unwrap()` rejects with RTK's
 * SERIALIZED error — a plain object, never an `Error` instance — so an
 * `instanceof Error` test always fails and every user would read the developer
 * fallback. Read `message` structurally instead, with a plain-language fallback.
 */


const createFailReason = (e: unknown): string => {
  const msg = typeof e === 'object' && e !== null ? (e as { message?: unknown }).message : undefined
  return typeof msg === 'string' && msg.trim() ? msg : 'the server did not respond'
}

/** The error hand-off's activation of the slot it just created
 *  (useErrorHandoffIntake). `keepTargetOnMissing`: that slot was JUST created,
 *  so a 404 from its detail fetch is a create/fetch race on a slot that exists
 *  -- the reducer keeps it selected instead of unwinding to the previous chat
 *  (#6309). Defined here because this page owns the classified call site. */
const activateHandoffSlot = (dispatch: AppDispatch, key: string) => dispatch(switchSlot({ key, keepTargetOnMissing: true })).unwrap()


// `mentionBoundary` / `strictMentionBoundary` / `leadingMentionBoundary`
// moved to utils/fileTokens.ts: the reconciliation staleness check, the
// remove-chip strip and send serialization share one definition there and
// can never disagree about what counts as a boundary.


/**
 * The main composer, with its callback props held at stable identities. This
 * page builds most of them inline on every render; the forwarders let
 * `memo(ChatInput)` skip a page render (a pin, a streamed frame) that changes
 * nothing the composer shows.
 */
function StableChatInput(props: React.ComponentProps<typeof ChatInput>) {
  return <ChatInput {...useStableCallbackProps(props)} />
}


export default function ChatPage({ mode, embedded, embedMode, popout, noUrlSync }: { mode?: string; embedded?: boolean; embedMode?: 'chat' | 'sessions'; popout?: boolean; noUrlSync?: boolean } = {}) {
  const {
    dispatch, moveSlotToFolder, navigate, navigationType, location, queryClient, provider, deleteTerminalSessionRef, searchParams, setSearchParams, isMobile, isTouch, topbarSlot, topbarTrailSlot,
    mobileNavRail, titleInTopbar, langGen, vv, keyboardInset, slots, switchSlotGone, filteredSlots, filteredSlotsRef, surfaceUnreadSlots, refreshTrigger, connected, creatingSlot, foregroundCreateId,
    foregroundCreateIdRef, lastCreatedActivationRef, unresumableResume, undeletableHistory, activeSlot, boundStore, voiceRecoverySlot, setVoiceRecoverySlot, appToolCallIds, mcpAppPanel,
    autoOpenGitPanel, autoOpenGitPanelKnown,
  } = useChatPageEnvironment({
    embedded, embedMode, popout,
  })
  // Tool-call ids already routed to a tab, so re-renders of the same app don't
  // yank focus back to the panel on every streaming update.
  useEffect(() => {
    if (!mcpAppPanel || !activeSlot) return
    for (const id of appToolCallIds) {
      // The claim lives at module scope, NOT in a ref: a ref is recreated on every
      // ChatPage mount, so a trip to Settings and back re-opened (and re-focused)
      // a tab the user had deliberately closed.
      if (!claimAppAutoOpen(activeSlot, id)) continue
      dispatch(openActivityPanel())
      // Chip title comes from the render payload already in the store -- the
      // payload IS what created this id (appToolCallIds keys off chat.mcpApps).
      // Read at effect time from the Provider-bound store (never the module
      // singleton, which a test harness does not mount) so unrelated chat
      // updates do not re-run the effect.
      const payload = boundStore.getState().chat.mcpApps?.[mcpAppKey(activeSlot, id)]
      tabsCtlRef.current?.openApp(id, mcpAppTabTitle(payload, i18nT('pages.chatPage.mcp_app_tab_title')), activeSlot)
    }
  }, [mcpAppPanel, activeSlot, appToolCallIds, dispatch, boundStore])
  const {
    messages, messagesRef, kiroCrewVersion, completedTurnCount, knowledgeFetch, knowledgeFetchRef, softStopAtMapRef, sentMessages, slotRunning, slotRunningRef, turnDisclosure, setTurnDisclosureFor,
    toolDisclosure, setToolDisclosureFor, turnRowMayBeLive, composerBusy, projectLocked, slotStopping, slotLoading, slotSwitchTarget, pendingQuestion, restoredQuestionNotice, pendingFollowup,
    folderSuggestion, followupTsBySlot, splitMode, setSplitMode, clearSplitOnSelect, crewWindow, openEmbeddedCrewWindow, navigateToEmbeddedSlot, splitAnchor, setSplitAnchor, activeTip, dismissTip,
    slotState, contextPct, contextTokens, activityOpen, slotHasMore, slotOldestIndex, cursorIsForActiveSlot, loadingOlder, olderFailed, activeViewIsBoundedPage, history, historyHasMore,
  } = useActiveSlotState({
    embedded, embedMode, popout, navigate, searchParams, activeSlot,
  })

  const draftStores = useComposerDraftStores()
  const { drafts, fileDrafts, pasteDrafts, sessionRefDrafts, saveDrafts, saveDraftsDebounced } = draftStores
  const {
    prevSlot, activeSlotRef, composerSlotRef, composerMountedRef, composerDraft, setInput, insertDashboardReply, inputNonBlank, inputRef, sendingRef,
  } = useComposerDraftState({
    activeSlot, drafts,
  })
  // The empty-transcript welcome screen and its "Continue a previous chat?" suggestions.
  const { updateHistoryQuery, historySuggestions, isWelcomeState, showHistorySuggestions } = useWelcomeState({
    messages, slotRunning, slotLoading, sendingRef, knowledgeFetch, pendingQuestion, history,
  })
  const pendingInput = useAppSelector(s => s.chat.pendingInput)
  const mainComposerAppend = useAppSelector(s => s.chat.mainComposerAppend)

  const [chatConfig, setChatConfig] = useState<ChatConfig>(loadChatConfig)
  useEffect(() => {
    const reload = () => { const next = loadChatConfig(); setChatConfig(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next) }
    window.addEventListener('focus', reload)
    window.addEventListener('mc-config-changed', reload)
    return () => { window.removeEventListener('focus', reload); window.removeEventListener('mc-config-changed', reload) }
  }, [])

  // Project is part of the roster's identity: re-pointing this slot at another
  // project changes which project-scoped agents exist. Derived here rather than
  // from `currentSlot`, which is computed further down the render body.
  const activeSlotProject = slots.find(s => s.key === activeSlot)?.project || undefined
  // Relay archives (old remote-executor sessions) are read-only: the server
  // refuses every turn-starting action on them (`relay_archive_refusal`), so the
  // client must not OFFER regenerate, edit-resend, rewind or continue either —
  // same predicate and same `executor` keying `selectContinuable` uses for Resume.
  const activeSlotRemoteBound = slotIsRemoteBound(slots.find(s => s.key === activeSlot))
  // The agent and model rosters the pickers offer.
  const {
    installedAgents, sidebarAgents, defaultAgent, effectiveAgents,
    defaultAgentFailed, toggleDefaultAgent,
    agentDropdown, setAgentDropdown, agentFilter, setAgentFilter, agentDropdownRef, agentInputRef, filteredAgents,
    effectiveModels,
  } = useSessionRosters({ activeSlot, activeSlotProject, refreshTrigger, dispatch })
  const {
    selectionCapabilitiesQ, selectionCapabilities, hiddenModelsQ, modelPickerConfigured, availableModels, codexPairModels, jevRouteOn, modelDropdown, setModelDropdown, modelFilter, setModelFilter,
    modelDropdownRef, modelInputRef, filteredModels, modelPickerReturnsFocusRef,
  } = useModelPickerModels({
    slots, activeSlot, effectiveModels,
  })
  // Roving-focus keyboard nav for the agent + model dropdowns (shared with StyledSelect/AgentSelector).
  const { onListKeyDown: onAgentListKeyDown } = useListboxKeyboard({
    open: agentDropdown,
    dropdownRef: agentDropdownRef,
    inputRef: agentInputRef,
    hasFilterInput: true,
    filteredCount: filteredAgents.length,
    onEnterSingleMatch: () => {
      const a = filteredAgents[0]
      if (a) { switchAgent(a.name, a.selection_kind); setAgentDropdown(false) }
    },
    closeToTrigger: () => setAgentDropdown(false),
  })
  const { onListKeyDown: onModelListKeyDown } = useListboxKeyboard({
    open: modelDropdown,
    dropdownRef: modelDropdownRef,
    inputRef: modelInputRef,
    hasFilterInput: true,
    filteredCount: filteredModels.length,
    onEnterSingleMatch: () => { pickModel(filteredModels[0].name) },
    closeToTrigger: () => setModelDropdown(false),
  })
  const {
    pendingAgent, pendingAgentRef, pendingAgentKindRef, setPendingAgent, pendingModel, pendingModelRef, setPendingModel, pendingProjectRef, setPendingProject, modelBtnRect, anchorModelBtn,
  } = useNewSessionPicks({
    modelDropdown,
  })
  const {
    actionError, setActionError, showActionError, messageQuote, steerMutation,
  } = useSteerDelivery({
    dispatch, activeSlot, drafts, saveDrafts, composerSlotRef, composerMountedRef, setInput, inputRef,
  })
  const {
    automationOpen, setAutomationOpen, automation, automationId, automationCreationReady, automationSnapshotFailed,
    applyAutomationChange,
  } = useSessionAutomation({ activeSlot, queryClient, dispatch })
  const approvalMode = useAppSelector(s => s.dashboard.approvalMode)

  // Close the slot-scoped automation surface on navigation. Its record comes
  // from the same Redux collection the sidebar reads; the WebSocket hook owns
  // both the cold REST snapshot and live updates.
  useEffect(() => {
    setAutomationOpen(false)
  }, [activeSlot, setAutomationOpen])
  const {
    scrollerRef,
    scrollToDisplayIndex,
  } = useScrollManager()

  // Share the settled cache scope and live-layout measurement gate with every
  // transcript host. Layout itself still follows the pane without a debounce.
  const { widthBucket: scrollerWidthBucket, canMeasure, bindScroller } = useTranscriptWidth()
  const {
    vGetFollowRef, vScrollerElRef, lastRealInputAtRef, sentinelPagesSinceInputRef, walkPagesSinceInputRef, walkLastInputAtRef, vScrollToBottomRef, vFarmIsMeasuredRef, earlierBarInViewRef,
    mountIndexRef, estimateRowTopRef,
  } = useTranscriptScrollRefs({
    activeSlot,
  })
  const {
    prefillHint, setPrefillHint, prefillEdited, setPrefillEdited, raisePrefillHint, autoSendRef, appLaunchSendRef, autoSendTick, setAutoSendTick, newSessionRef, tokenConsumingRef, widgetPrefillRef,
    consumedPrefillRef,
  } = useComposerIntakeRefs()

  // Error hand-offs ("Ask the agent"): claimed into a FIFO, one fresh session at a time.
  useErrorHandoffIntake({
    embedded,
    connected,
    mode,
    dispatch,
    drafts,
    inputRef,
    activeSlotRef,
    showActionError,
    activateCreatedSlot: activateHandoffSlot,
    createFailReason,
  })

  // Text that reaches the composer from outside a keystroke (see launchIntake).
  usePendingInputIntake({
    pendingInput,
    activeSlot,
    embedded,
    searchParams,
    setSearchParams,
    dispatch,
    autoSendRef,
    newSessionRef,
    setAutoSendTick,
    drafts,
    saveDraftsDebounced,
    setInput,
    raisePrefillHint,
  })
  useMainComposerHandoff({
    dispatch, activeSlot, splitMode, drafts, saveDraftsDebounced, composerSlotRef, setInput, inputRef, mainComposerAppend, raisePrefillHint,
  })

  // Consume prompt from token payload (channel challenge-and-redirect flow).
  // The prompt is HMAC-signed in the token — server validates the signature
  // and sets the session cookie before the SPA loads. No auto-send — the user
  // must press Enter to confirm.
  //
  // Three cases, driven by signed claims in the token:
  //  1. session_key present → the originating Slack thread is already linked to
  //     a dashboard session; reconnect to THAT session instead of making a new
  //     one (fixes "thread reply spawns a disconnected session").
  //  2. channel + thread_ts present (no session_key) → fresh thread; create a
  //     new session and auto-link it back to that Slack thread so agent
  //     responses flow into the thread.
  //  3. neither → plain new session (e.g. a top-level channel message).
  // In all cases the prompt is seeded via PREFILL_STORAGE_KEY (the channel the
  // slot-restore effect honors) AND set directly once the target slot is
  // active, so the previous slot's draft can't clobber it.
  useEffect(() => {
    // tokenConsumingRef is initialized true when a token is in the URL; every
    // early return below MUST clear it, or the auto-select guard stays engaged
    // for the whole session and blocks slot selection.
    if (embedded) { tokenConsumingRef.current = false; return }
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) { tokenConsumingRef.current = false; return }
    // Always strip token from URL to prevent leakage via referrer/history.
    // Two layers, both required (PR #11112 review):
    //  1. Raw replaceState scrubs the visible URL immediately — but ONLY the
    //     `token` param, preserving `?sid` so a session deep link
    //     (`/chat?sid=…&token=…`) still names its slot after the strip.
    //     Preserves history.state for the same reason as the prefill strip.
    //  2. setSearchParams scrubs the ROUTER's own searchParams state, which
    //     raw replaceState never updates — the `?sid` sync effects
    //     (useChatPageSessionController) copy router params back into the URL
    //     on slot activation, and would otherwise restore the live credential
    //     into browser history.
    const scrubbed = new URLSearchParams(window.location.search)
    scrubbed.delete('token')
    const scrubbedQs = scrubbed.toString()
    window.history.replaceState(
      window.history.state, '', window.location.pathname + (scrubbedQs ? `?${scrubbedQs}` : ''))
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('token')
      return next
    }, { replace: true })
    const prompt = extractPromptFromToken(token)
    if (!prompt) { tokenConsumingRef.current = false; return }
    const { sessionKey, channel, threadTs } = extractSlackContextFromToken(token)
    // Backend session keys are history keys (dashboard:chat-…); the frontend
    // slot key is the bare form.
    const targetSlot = sessionKey ? sessionKey.replace(/^dashboard:/, '') : null
    tokenConsumingRef.current = true
    ;(async () => {
     try {
      let slotKey: string | null = null
      if (targetSlot) {
        // Case 1: reconnect to the existing linked session.
        try {
          await dispatch(switchSlot(targetSlot)).unwrap()
          slotKey = targetSlot
        } catch {
          // Session vanished (deleted/expired) — fall back to a new one.
        }
      }
      if (!slotKey) {
        // No targetSlot (or reconnect failed): create the session HERE and,
        // for a fresh thread, slack-link it so responses mirror to Slack.
        try {
          const create = dispatch(createSlot({ mode, sessionFolder: false }))
          noCarryCreateIdsRef.current.add(create.requestId)
          const slot = await create.unwrap()
          slotKey = slot?.key ?? null
        } catch {
          // ignore — fall back to prefilling the current slot
        }
        // Case 2: auto-link the new session back to the originating thread so
        // responses flow into Slack. Best-effort; failure just leaves it
        // unlinked.
        if (slotKey && channel && threadTs) {
          try { await api.slackLink(slotKey, channel, threadTs) } catch { /* non-fatal */ }
        }
      }
      // We have created/reconnected AND made the target slot active. Critically,
      // clear newSessionRef and pin activeSlot to this slot so send() reuses it
      // on Enter — otherwise send()'s forceNew path would spawn a SECOND,
      // unlinked slot and break Slack mirroring.
      if (slotKey) {
        newSessionRef.current = false
        dispatch(switchSlot(slotKey))
        safeSetSessionItem(
          PREFILL_STORAGE_KEY,
          JSON.stringify({ slotKey, prompt, ts: Date.now() }),
        )
      }
      // While the switch to `slotKey` has not committed yet, the composer still
      // belongs to the old session and a write here would persist the prompt
      // into ITS draft. The slot-change effect restores the prompt from the
      // prefill hand-off written above, so only write when the composer is
      // already on the target (or there is no target to switch to).
      if (!slotKey || composerSlotRef.current === slotKey) setInput(prompt)
      raisePrefillHint()
      autoSendRef.current = prompt
      setAutoSendTick(t => t + 1)
     } finally {
      // Release the auto-select guard once the session is created/linked (or
      // failed), so normal slot selection resumes.
      tokenConsumingRef.current = false
     }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // What the composer holds besides its text, then the per-commit / per-switch
  // draft bookkeeping over it. The draft commit runs from `ComposerDraftSync`'s
  // effect, a child of this page, so it lands before this page's own effects in
  // the same commit: ahead of the slot-change restore and the composer-key
  // advance, which is what keeps a keystroke batched with a switch on the slot
  // it was typed in.
  const staging = useComposerStaging({ activeSlot, splitMode, composerSlotRef, pickedFileTokens: draftStores.pickedFileTokens })
  const {
    uploading, setUploading,
    pendingFiles, setPendingFiles, pendingFilesRef,
    pickedFileTokens, mergeSlotTokens,
    snipFrame, setSnipFrame, snipSlotRef,
    setPasteBlocks, pasteBlocksRef, pasteSlice,
    pendingSessions, setPendingSessions, pendingSessionsRef,
    stageSessionRef, unstageSessionRef, canStageSessionRef,
    chatPaneEl, setChatPaneEl,
    uploadError, setUploadError, uploadHint, setUploadHint,
    resizedInfo, setResizedInfo,
  } = staging
  const { reconcileFileChipsRef, onComposerDraftCommit, noCarryCreateIdsRef } = useComposerDraftLifecycle({
    activeSlot,
    stores: draftStores,
    staging,
    prevSlot,
    composerSlotRef,
    inputRef,
    setInput,
    consumedPrefillRef,
    foregroundCreateId,
    foregroundCreateIdRef,
    lastCreatedActivationRef,
    knowledgeFetchRef,
    raisePrefillHint,
    setPrefillHint,
    setActionError,
    updateHistoryQuery,
  })
  const { rect: agentBtnRect, anchorTo: anchorAgentBtn } = useAnchoredTriggerRect(agentDropdown)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const { rect: projectBtnRect, anchorTo: anchorProjectBtn } = useAnchoredTriggerRect(projectPickerOpen)

  // Prevent Chrome from navigating to dropped files.
  // Must be on document to catch drops anywhere on the page.
  useEffect(() => {
    const preventNav = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    document.addEventListener('dragover', preventNav)
    document.addEventListener('drop', preventNav)
    return () => {
      document.removeEventListener('dragover', preventNav)
      document.removeEventListener('drop', preventNav)
    }
  }, [])

  const pendingDirs = useStagedFolderRefs(composerDraft)
  // Live persistence of every staged resource, then the composer-key advance,
  // in that order (see useStagedDraftPersistence).
  useStagedDraftPersistence({ activeSlot, composerSlotRef, stores: draftStores, staging })
  const {
    isMac, voiceSubmitRef, composerRef, voiceCaretRef, voicePendingCaretRef, composerVoiceOptions,
  } = useComposerVoiceHost({
    embedded, drafts, saveDrafts, activeSlotRef, composerSlotRef, inputRef,
  })
  const {
    currentProjectRef, terminalReuseRef, terminalCfgUnsettledRef, terminalCfgReadFailedRef,
  } = useRunInTerminalConfig({
    slots, activeSlot,
  })

  const memorySwitchingRef = useRef(false) // Held true while a memory-mode switch runs (see usePanelLayout).
  const resources = useChatPageResourcesController({
    activeSlot,
    activeSlotRef,
    messages,
    slotLoading,
    dispatch,
    queryClient,
    showActionError,
    composer: {
      inputRef,
      setInput,
      drafts,
      currentProjectRef,
      voiceCaretRef,
      voicePendingCaretRef,
      saveDrafts, composerLockedRef: memorySwitchingRef,
    },
    capture: {
      setUploading,
      setUploadError,
      setUploadHint,
      setResizedInfo,
      snipSlotRef,
      setSnipFrame,
    },
  })
  const {
    tabsCtl,
    hasLiveAppTab,
    hasBrowserTab,
    search,
    sourceHostsRef,
    jiraSourceHosts,
    jiraSourceHostsRef,
    githubSourceHostsRef,
    panelSources,
    panelIssues,
    selectedSourceUrl,
    selectedIssueUrl,
    selectSource,
    selectSourceUrl,
    selectIssueUrl,
    reconcileSourceUrl,
    reconcileIssueUrl,
    setRevealedSources,
    addSourceCommentToChat,
    colorThemeRef,
    handleFileOpen,
    handleOpenWorkingTreeDiff,
    handleFolderOpen,
    handleArtifactOpen,
    handleOpenDiff,
    handleFileSave,
    handleCapture,
    handleSnipComplete,
    handleSnipCancel,
    composerUploadFiles,
    cancelUpload,
    uploadCancellable,
    handleOptimizeResult,
    dragOver,
    dropTargetProps,
  } = resources
  const sendHeld = useComposerSendHeld(activeSlot)

  // Open the Subagents panel from a completion card. A per-agent event
  // deep-links to the agent it reports on, so the panel lands on that
  // transcript rather than whatever was last selected; a wave digest names no
  // single agent and just opens the tab.
  const handleSubagentPanelOpen = useCallback((parsed: ParsedSubagentCompletion) => {
    if (parsed.kind === 'single') dispatch(selectSubagent(parsed.agentId))
    dispatch(openActivityToTab('subagents'))
  }, [dispatch])

  // `filteredSlots`, not `slots`: a surface this page cannot render would chip to a
  // destination the switch clears. That narrowing IS the shared builder's rule
  // (`utils/sessionRoster`), which the Members page's crewmate DM also uses --
  // its chips navigate here, so the two must agree on which slots may chip.
  // Signature because heartbeats remint slot objects.
  const sessionTitleSig = JSON.stringify(filteredSlots.map(s => [s.key, s.title || s.key]))
  const sessionTitles = useMemo(
    () => sessionTitleRoster(filteredSlots),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the value-equal pair signature, not the slot objects (see above)
    [sessionTitleSig],
  )

  const { data: forkCfg } = useQuery<{ tail_fork_enabled?: boolean }>({ queryKey: ['dashboardConfig'], queryFn: fetchDashboardConfig, staleTime: 30_000 })
  const handleFork = useCallback(async (visibleIndex: number, messageId?: string) => {
    if (!activeSlot) return
    let direction: 'head' | 'tail' = 'head' // hoisted so the catch advises the same way
    try {
      // Fork WITHOUT a prompt: an unsent composer draft must never be
      // auto-submitted into the freshly forked session. The
      // per-slot draft mechanism saves the source slot's composer text on
      // slot-switch, so the user's parked draft stays safe in the original
      // session and the fork opens with an empty composer.
      //
      // forkCfg is undefined until the dashboardConfig query resolves for the
      // first time. Use the cache when warm; otherwise fetch a fresh value
      // directly so direction never silently falls back to an undefined config
      // — which would downgrade an intended tail-fork to a head-fork whenever
      // the query has errored or settled with no data, not just while loading.
      const resolvedCfg = forkCfg ?? await api.dashboardConfig()
      direction = resolvedCfg?.tail_fork_enabled ? 'tail' : 'head'
      const result = await dispatch(forkSlot({ slot: activeSlot, atIndex: visibleIndex, messageId, direction })).unwrap()
      if (result.ok) {
        await dispatch(switchSlot(result.key))
      } else {
        showTranscriptForkFailure(showActionError, result.code, result.error, direction)
      }
    } catch (e) {
      // A refusal is a non-2xx, so the thunk REJECTS: its code rides the rejection payload.
      showTranscriptForkFailure(showActionError, (e as { code?: string } | null)?.code, errMessage(e), direction)
    }
  }, [activeSlot, dispatch, forkCfg, showActionError])

  const transcriptEarly = useChatPageTranscriptEarlyController({
    activeTip,
    mountIndexRef,
    estimateRowTopRef,
    scrollerRef,
    scrollToDisplayIndex,
    slotRunningRef,
    vGetFollowRef,
    vScrollToBottomRef,
  })
  const {
    scrollBottom,
    autoFollowAllowed,
    handleSurveyLayoutChange,
    composerBandRef,
    navToDisplayIndex,
    displayItemsRef,
    pinFoldRef,
    pinCardRef,
    pinEnabledRef,
    pinned,
    setPinned,
    pinExpanded,
    setPinExpanded,
    onPinCollapsedHeight,
    scrollTranscriptBy,
    updatePinnedPrompt,
    onScrollPin,
    pinnedJumpChrome,
    scrollToPinnedPrompt,
  } = transcriptEarly

  // Sticky-bottom scroll state is owned by the virtualizer (`virt.isAtBottom`,
  // wired by useTranscriptPaging in transcriptPaging.ts). No local mirror — a single source of truth avoids
  // dual-controller drift.

  // New content while following is handled inside the virtualizer (RO re-pin
  // for in-place growth + append layout-effect pin for new items), so ChatPage
  // does not run its own message-length scroll effect.
  const session = useChatPageSessionController({
    activeSlot,
    activeSlotRef,
    connected,
    dispatch,
    drafts,
    embedMode,
    embedded,
    fileDrafts,
    filteredSlots,
    filteredSlotsRef,
    history,
    inputNonBlank,
    isMobile,
    locationKey: location.key,
    locationPathname: location.pathname,
    locationHash: location.hash,
    mode,
    navigate,
    navigationType,
    newSessionRef,
    noUrlSync,
    pasteDrafts,
    popout,
    prevSlot,
    saveDrafts,
    searchParams,
    slots,
    tokenConsumingRef,
  })
  const {
    appSlotLaunch,
    setAppSlotLaunch,
    closeSessionTab,
    drawerPopRef,
    handleResumeSession,
    highlightTs,
    initialMidRef,
    initialMsgRef,
    initialSidRef,
    newSlotFailed,
    newSlotMutation,
    openSlotInNewTab,
    ownsSessionTabs,
    selectSessionTab,
    sessionTabs,
    setHighlightTs,
    setNewSlotFailed,
    setSidError,
    sidError,
    sidMatches,
    setSidMatches,
    openShortNameMatch,
  } = session

  // Only the routed chat consumes app launch intents; see useAppLaunchIntake.
  useAppLaunchIntake({
    embedded,
    connected,
    activeSlot,
    slotLoading,
    locationKey: location.key,
    appSlotLaunch,
    setAppSlotLaunch,
    autoSendRef,
    appLaunchSendRef,
    newSessionRef,
    setAutoSendTick,
    drafts,
    saveDraftsDebounced,
    setInput,
    raisePrefillHint,
    setPendingAgent,
    setActionError,
  })

  // Auto-scroll during streaming — only when pinned to bottom
  const lastMsg = messages[messages.length - 1]
  const isStreaming = lastMsg?.role === 'streaming'
  // Follow-up option chips and the ownership of the text they append.
  const {
    followUpOptions, followUpSourceKey, followUpMulti,
    followUpPicked, followUpPickedRef, toggleFollowUpOption,
    composerRootChange, composerUserEdit,
  } = useFollowUpChips({
    messages, isStreaming, pendingQuestion, activeSlot, inputRef, setInput, prefillEdited, setPrefillEdited,
  })
  const {
    dashCfg, splitFeatureEnabled, linkPreviewsOn, socialShareOn, jevAutoConsented, connectionsUiOn, openActivePopout, focusActivePopout, returnSelfToMain, activePoppedOut, planTaskId,
  } = usePageFlags({
    activeSlot, messages, splitMode, fileDrafts, saveDrafts, prevSlot, activeSlotRef, composerSlotRef, pendingFilesRef, setPendingFiles,
  })
  const {
    refusedPress, setRefusedPress, showRefusedPress,
  } = useRefusedPress()
  const {
    send,
  } = useComposerSend({
    mode, dispatch, slots, connected, activeSlot, knowledgeFetchRef, slotRunning, drafts, fileDrafts, pasteDrafts, saveDrafts, sessionRefDrafts, activeSlotRef, composerSlotRef, composerMountedRef,
    setInput, inputRef, sendingRef, pendingAgentRef, pendingAgentKindRef, setPendingAgent, pendingModelRef, setPendingModel, pendingProjectRef, setPendingProject, setActionError, showActionError,
    messageQuote, setPrefillHint, autoSendRef, setAutoSendTick, newSessionRef, widgetPrefillRef, mergeSlotTokens, pasteBlocksRef, pendingFilesRef, pendingSessionsRef, pickedFileTokens, setPasteBlocks,
    setPendingFiles, setPendingSessions, composerRef, currentProjectRef, colorThemeRef, autoFollowAllowed, scrollBottom, setRefusedPress, createFailReason,
  })

  // Submit inline document comments to the session the file was opened from,
  // not the currently-active one. If the user switched sessions while the
  // panel was open, switch back to the origin session so the prompt + reply
  // land where the document belongs. switchSlot.pending sets activeSlot
  // synchronously, but send()'s closure activeSlot is stale until re-render,
  // so the origin slot is passed to send() explicitly.
  const submitComments = useCallback((message: string) => {
    // Defense-in-depth: the panels' submit buttons are gated on `connected`,
    // but bail here too so an offline call can't switch the active session
    // and then have send() silently drop the message.
    if (!connected) return false
    const target = tabsCtl.activeTab?.slot ?? null
    // The batch is a Send press for the TARGET slot: it steers or queues per
    // that slot's busy-send mode, read before a switch can change what the
    // store says about it.
    const sendSlot = target ?? activeSlotRef.current
    const steerFlag = sendSlot ? slotBusySteer(store.getState(), sendSlot, jevAutoConsented) : undefined
    if (target && target !== activeSlot) dispatch(switchSlot(target))
    // The delivery verdict flows back to the panel: ArtifactPanel marks a
    // comment batch as sent only when this resolves true.
    return send(message, target ?? undefined, steerFlag)
  }, [connected, tabsCtl.activeTab, activeSlot, dispatch, send, jevAutoConsented, activeSlotRef])

  // The armed auto-send (?autoSend=1, a signed token, an app launch) and a
  // widget action's prefill.
  useAutoSendIntake({ connected, send, autoSendTick, autoSendRef, appLaunchSendRef, widgetPrefillRef, setInput, raisePrefillHint })
  const {
    approve, dismissApproval, switchAgent, pickModel, setProject,
  } = useSessionChoices({
    dispatch, queryClient, activeSlot, codexPairModels, setModelDropdown, modelPickerReturnsFocusRef, setPendingAgent, setPendingModel, setPendingProject,
  })

  const currentSlot = slots.find(s => s.key === activeSlot)
  // App-contributed session controls and the folder context they are handed.
  const sessionControlState = useComposerSessionControls({ activeSlot, currentSlot, queryClient })
  const {
    sessionControls, openSessionControl, setOpenSessionControl, sessionControlRect, anchorSessionControl,
    refreshSessionControlStatuses, activeFolderName, sessionControlKey, sessionControlStatuses, chatFolders,
    chatFoldersError, chatFoldersLoaded, mobileNewSessionInFlightRef, mobileNewSessionBusy, setMobileNewSessionBusy,
  } = sessionControlState

  // "Keep this chat" (issue #9694): promotes an ephemeral (incognito/temporary)
  // slot to persistent. Human-initiated only — there is no MCP tool or agent
  // path that can reach this, by design (see chat_fork.api_chat_slot_promote).
  // Uses the shared async confirm dialog (never window.confirm, which would
  // freeze the tab) so the user sees exactly what becomes retained before the
  // whole transcript is copied into a brand-new persistent slot; the
  // ephemeral original is left open and untouched either way.
  const { confirm: confirmPromote, confirmDialog: promoteConfirmDialog } = useConfirm()
  const handlePromote = useCallback(async () => {
    if (!activeSlot) return
    const isTemporary = currentSlot?.memory_mode === 'temporary'
    const confirmed = await confirmPromote({
      title: i18nT('pages.chatPage.keep_this_chat_confirm_title'),
      body: i18nT(
        isTemporary
          ? 'pages.chatPage.keep_this_chat_confirm_body_temporary'
          : 'pages.chatPage.keep_this_chat_confirm_body',
      ),
      confirmLabel: i18nT('pages.chatPage.keep_this_chat'),
      danger: false,
    })
    if (!confirmed) return
    try {
      const result = await dispatch(promoteSlot({ slot: activeSlot })).unwrap()
      if (result.ok) {
        await dispatch(switchSlot({ key: result.key, announceOnMissing: true }))
      } else {
        showActionError(i18nT('pages.chatPage.keep_this_chat_failed_error', { error: result.error || i18nT('pages.chatPage.unknown_error') }))
      }
    } catch (e) {
      showActionError(i18nT('pages.chatPage.keep_this_chat_failed_error', { error: errMessage(e) || i18nT('pages.chatPage.unknown_error') }))
    }
  }, [activeSlot, confirmPromote, currentSlot?.memory_mode, dispatch, showActionError])

  // One source for both same-meaning markers in the agent pop-up: the row's check and
  // the default-agent row's label. Reading the slot twice let them disagree.
  const activeAgentName = currentSlot?.agent || defaultAgent || 'default'
  // Refs so the "run in terminal" listener (registered once) always sees the
  // live panel controller + this chat's working directory.
  const tabsCtlRef = useRef(tabsCtl); tabsCtlRef.current = tabsCtl
  const {
    revealAppInPanel,
  } = useAppPanelReveal({
    dispatch, activeSlot, boundStore, search, tabsCtlRef,
  })
  // `@`-mentions of files and folders and the file chips they stage.
  // The composer's polite status line for an attachment the reconciliation
  // changed on its own (#14597). `nonce` advances on every announcement so the
  // same file removed, re-added and removed again re-announces each time: a
  // screen reader fires only when the live region's text CHANGES, and a repeated
  // message is the same text — the nonce lets ChatInput force the change.
  const [attachmentAnnouncement, setAttachmentAnnouncement] = useState<{ text: string; nonce: number }>({ text: '', nonce: 0 })
  const announceAttachmentChange = useCallback((text: string) => {
    setAttachmentAnnouncement(prev => ({ text, nonce: prev.nonce + 1 }))
  }, [])
  const { clampOutOfTokens, handleAddToContext, removeFileChip, removeDirChip, selectPickedFile, mentionKeyEdit, optimizerMentionGuard } = useFileMentionActions({
    staging,
    inputRef,
    setInput,
    currentProjectRef,
    voiceCaretRef,
    voicePendingCaretRef,
    reconcileFileChipsRef,
    announceAttachmentChange,
  })
  const {
    followupTsRef, followupAddToSession, folderSuggestionAccept, folderSuggestionDecline, followupBranchFor,
  } = useFollowupCardActions({
    dispatch, moveSlotToFolder, activeSlot, folderSuggestion, followupTsBySlot, inputRef,
  })

  // The post-create half both spawn routes share: open a session (scoped to
  // `project` when there is one), hand it the prompt, take the user to it, and
  // only then clear the card. Every step fails CLOSED with the caller's message
  // for that step, so a route can name what it already left behind (the
  // worktree route names the reusable worktree) and no failure ever prefills
  // an unrelated conversation.
  const openFollowupSession = useCallback(async (
    item: FollowupItem,
    target: {
      project?: string
      folderId?: string | null
      originSlot: string | null
      originTs: number | undefined
      fail: { notCreated: string; noSession: string; notOpened: string; notFocused: string }
    },
  ) => {
    const { project, folderId, originSlot, originTs, fail } = target
    let slotKey = ''
    try {
      // `activate: false` on purpose: the slot must be SCOPED to its directory
      // before the user can type into it. Activating first (the default) leaves a
      // window where the composer is live but `chatSlotProject` is still pending,
      // so a turn sent in that window would run in the default directory — agent
      // tools writing to the wrong checkout. It also means a scoping failure can
      // render its error on the still-mounted card instead of unmounting it.
      const slot = await dispatch(createSlot({ mode, project, folder_id: folderId, activate: false })).unwrap()
      slotKey = slot?.key || ''
    } catch {
      throw new Error(fail.notCreated)
    }
    // A fulfilled thunk with no key would skip every guard below (scoping,
    // activation, focus verification) and prefill whatever session is on screen
    // — the exact fail-open the docs promise not to do. Fail closed instead.
    if (!slotKey) throw new Error(fail.noSession)
    // Scoping is NOT done here: `createSlot({ activate: false })` awaits the
    // project assignment before it publishes the slot, and deletes the session if
    // that fails, so the slot is never reachable in an unscoped state. A failure
    // therefore rejects the thunk and is reported by the catch above.
    // createSlot's fulfilled reducer deliberately does NOT activate its result
    // if the user switched sessions while the create was in flight. The
    // prefill below writes to the *active* composer, so without this the
    // prompt would land in whatever unrelated session is on screen and the new
    // session would open empty. The user asked for this session by clicking;
    // take them to it — and if that fails, surface the error and keep the card
    // rather than prefilling the wrong conversation.
    // Read the store directly, NOT activeSlotRef: the ref is refreshed by a
    // render, and `unwrap()` resolves as soon as the reducer ran — so a stale
    // ref would report a failure (and skip the prefill) on a switch that in
    // fact succeeded. store.getState() sees the committed value immediately.
    // Hand the prompt over through PREFILL_STORAGE_KEY *before* the switch — the
    // same channel the ?sid / popout paths use. `setPendingInput` alone loses the
    // race: its consuming effect is declared BEFORE the per-slot draft-restore
    // effect, so when the switch and the prefill land in one React commit the
    // restore runs last and overwrites the composer with the incoming slot's
    // (empty) draft, and the prompt vanishes. Seeding the prefill makes the
    // restore itself apply the prompt, so there is nothing left to race.
    writePrefill(slotKey, item.prompt)
    if (store.getState().chat.activeSlot !== slotKey) {
      try {
        await dispatch(switchSlot(slotKey)).unwrap()
      } catch {
        throw new Error(fail.notOpened)
      }
    }
    if (store.getState().chat.activeSlot !== slotKey) throw new Error(fail.notFocused)
    dispatch(setPendingInput(item.prompt))
    if (originSlot) dispatch(clearFollowupCard({ slot: originSlot, ts: originTs }))
  }, [dispatch, mode])
  const {
    followupStartInWorktree, followupStartInNewChat,
  } = useFollowupStarts({
    activeSlot, currentSlot, followupTsRef, followupBranchFor, openFollowupSession,
  })

  // Outside events feeding the side panel, the dock terminal and the composer,
  // then the cold file tabs' reads.
  const { runInTerminalScope } = useChatEventBridges({
    activeSlot,
    activeSlotRef,
    messages,
    slots,
    dispatch,
    queryClient,
    showActionError,
    tabsCtlRef,
    currentProjectRef,
    deleteTerminalSessionRef,
    terminalReuseRef,
    terminalCfgUnsettledRef,
    terminalCfgReadFailedRef,
    inputRef,
  })
  useColdFileTabHydration({ tabsCtl, showActionError })
  // Session mode of the active slot. In the unified chat view the page-level
  // `mode` prop is always '' — the slot's own mode is the source of truth.
  const effectiveMode = currentSlot?.mode || mode
  const title = currentSlot?.title && currentSlot.title !== currentSlot.key ? currentSlot.title : activeSlot || ''
  const displayMode = slotApprovalMode(approvalMode, currentSlot)
  // What the composer's model, effort and project chips show.
  const {
    shownModel, _pinShownModel, chipDefault, modelMarker, effortSupported, effortLevelsOverride,
    _modelPinAgent, _modelPinActive, _modelPinPinned, pinModelToAgentMut,
    defaultEffort, effectiveEffort,
    _slotProject, projectGit, projectGitError, projectBranch,
  } = useComposerChips({
    currentSlot,
    defaultAgent,
    pendingAgent,
    installedAgents,
    provider,
    availableModels,
    codexPairModels,
    selectionCapabilities,
    selectionCapabilitiesQ,
    dispatch,
    queryClient,
    showActionError,
  })
  const {
    sidebarPinned, setSidebarPinned, sidebarPinnedRef, sidebarAutoHidden, sidePanelDock, sidePanelDockAnim, sidebarWidth, setSidebarWidth, sidebarDragging, setSidebarDragging, setEditingTitleSlot,
    editingTitle, enterSplit, splitAnchorForActive, activeIsSplitAnchor,
  } = usePaneLayoutState({
    embedMode, dispatch, slots, activeSlot, autoOpenGitPanel, autoOpenGitPanelKnown, setSplitMode, splitMode, setSplitAnchor, tabsCtl, splitFeatureEnabled, _slotProject, projectGit, projectGitError,
  })
  const {
    lastTextIdx, regenerating, setRegenerating, handleRegenerate,
  } = useRegenerate({
    dispatch, activeSlot, messages, slotRunning, activeSlotRemoteBound, isStreaming, setRefusedPress, showRefusedPress,
  })

  // ---- Continue the thread ---------------------------------------------------
  const {
    continuable, interrupted, sendUnconfirmed, continuing, handleContinue,
    openModelPickerFromError, openDefaultModelSetting, openKiroSignIn, openMemberCapabilities, openTurnLimitSetting,
    cardOwnsRecovery,
    freshSession, handleFreshSession,
  } = useTurnRecovery({
    activeSlot,
    slotRunning,
    messages,
    navigate,
    anchorModelBtn,
    setModelDropdown,
    modelPickerReturnsFocusRef,
    showRefusedPress,
  })
  const {
    inputAreaRef, dockH, dockGutter, dockRef, quoteWholeMessage, handleQuote, handleAsk, flyingQuote, endQuoteFlight,
  } = usePageSelectionActions({
    dispatch, activeSlot, setInput, messageQuote, scrollerRef,
  })
  // Split view's panes ask about THEIR slot, but the activity panel — and the
  // Side Chat inside it — is bound to the active slot. Re-bind it first (the
  // same switchSlot the grid's collapse path uses; split mode itself is not
  // left), then open the tab. The seed names the slot, so it waits for the
  // re-bound panel's composer rather than landing on the old slot's.
  //
  // Offline, the re-bind is withheld like every other switchSlot in this file
  // (the tab strip, the sidebar row, the ?sid deep link): a rejected switch
  // clears the pane's active messages and the transcript the reader just
  // selected from disappears until reconnect. The grid is handed no
  // `openSideChat` at all while disconnected, so the panes' toolbars offer
  // Copy / Quote only (capability by omission, never an Ask into the void);
  // the guard here covers the frame between the drop and the re-render, and
  // rather than open a Side Chat bound to some OTHER slot it does nothing.
  // Read at click time, not captured: the callback is memoized and the
  // gateway can drop between renders (the tab strip's own gate, now inside
  // useChatPageSessionController, keeps its ref the same way).
  const connectedRef = useRef(connected)
  connectedRef.current = connected
  const openSideChatForPane = useCallback((slot: string): boolean | Promise<boolean> => {
    if (slot === activeSlot) {
      dispatch(openActivityToTab('side'))
      return true
    }
    // `false` tells the selection seam the Ask did NOT happen, so it does
    // not seed a quote into a Side Chat that never opened.
    if (!connectedRef.current) return false
    // The re-bind is a request the server can reject (the pane's session was
    // deleted under it); `switchSlot.rejected` then falls back to the slot the
    // page was on. Report the verdict only once it is known: the seam seeds
    // on `true`, and a rejection is surfaced through the page's ErrorNotice
    // instead of leaving a silent, invisible seed behind.
    return dispatch(switchSlot(slot)).unwrap().then(
      () => {
        // A later switch (the user clicked another pane, or Asked from it)
        // may have landed while this one was in flight; the panel is bound to
        // whatever is active NOW, so opening the Side tab here would show the
        // other pane's Side Chat with this quote hidden in this slot's draft.
        // Report the Ask as not happened instead of seeding a stale slot.
        if (boundStore.getState().chat.activeSlot !== slot) return false
        dispatch(openActivityToTab('side'))
        return true
      },
      (e: unknown) => {
        showActionError(i18nT('pages.chatPage.side_chat_pane_gone', { error: errMessage(e) || i18nT('pages.chatPage.unknown_error') }))
        return false
      },
    )
  }, [activeSlot, boundStore, dispatch, showActionError])
  const {
    handleEditResend, editLast, setEditLast, editSeqRef, farmPassRef, handleEditConsumed, searchCtxValue, renderUserContentCb, lastRole, streamTick, transcriptHot, railWidth, winW,
    effectiveSidebarWidth, toggleAct, handleSpeak, handleApplyPlan,
  } = useMessageActions({
    dispatch, navigate, filteredSlotsRef, connected, activeSlot, messages, slotRunning, activityOpen, activeSlotRef, activeSlotRemoteBound, showActionError, handleFileOpen, handleFolderOpen, search,
    tabsCtl, sessionTitles, selectSessionTab, linkPreviewsOn, planTaskId, setSidebarPinned, sidebarAutoHidden, sidebarWidth, setRegenerating,
  })

  // The rows the virtualizer draws (see transcriptRows).
  const { renderedTranscript, renderedDisplayItems } = useTranscriptRows({
    messages, slotRunning, activeSlot, appToolCallIds, displayItemsRef, scrollerRef,
  })

  // Pinned prompt: keep the enablement ref in sync (updatePinnedPrompt is declared
  // above chatConfig and reads it through a ref), and recompute after the list
  // changes — a new turn shifts geometry with no scroll event of its own.
  useEffect(() => {
    pinEnabledRef.current = chatConfig.pinLastPrompt
    if (!chatConfig.pinLastPrompt) setPinned(null)
  }, [chatConfig.pinLastPrompt, pinEnabledRef, setPinned])
  useEffect(() => { updatePinnedPrompt() }, [renderedDisplayItems, updatePinnedPrompt])
  // Expanded state PERSISTS as the pinned prompt is replaced by the next one
  // while scrolling — the user asked for a sticky "keep it open" behaviour, so we
  // do NOT collapse on `pinned.idx` change. It still resets on slot switch (useTranscriptPaging)
  // (a different session should start collapsed).

  // Virtualized display — only mounts items in the viewport window. The
  // virtualizer shares `scrollerRef` with useScrollManager so the legacy
  // scroll APIs (scrollToDisplayIndex, scrollToBottom) operate on the
  // same DOM element. Its own follow-output handles streaming auto-pin
  // and append-pin, so the legacy useStreamingScroll/useFollowOutput
  // calls below are no-ops in this configuration but are kept invoked
  // for hook-call stability.
  const { stableMsgKey, stableAnchorId, anchorAltId, prefetchStartIndex, virtualKey } = useStableRowKeys({
    renderedDisplayItems, appToolCallIds, activeSlot,
  })
  const {
    handleLoadEarlier, virt, isAtBottom, visibleDisplayItems, spinnerNearTop, reportSlashRefusal,
  } = useTranscriptPaging({
    dispatch, activeSlot, slotRunning, slotHasMore, scrollerRef, canMeasure, scrollerWidthBucket, vGetFollowRef, vScrollerElRef, lastRealInputAtRef, sentinelPagesSinceInputRef, walkPagesSinceInputRef,
    walkLastInputAtRef, vScrollToBottomRef, vFarmIsMeasuredRef, earlierBarInViewRef, mountIndexRef, estimateRowTopRef, displayItemsRef, setPinExpanded, setPinned, updatePinnedPrompt, isStreaming,
    setRefusedPress, renderedDisplayItems, anchorAltId, prefetchStartIndex, stableAnchorId, virtualKey,
  })
  // A busy turn: steer into it, answer its question card, stop it, and the queued-message cards.
  const {
    queuedMessages, systemDeliveryCount, steer, stopTurn, keepQuestionAnswer, answerQuestionCard,
    handleCancelQueued, handleInterruptQueued, handleEditQueued, handleReorderQueued, queuePendingIds,
  } = useBusyTurnControls({
    activeSlot,
    messageQuote,
    currentSlot,
    connected,
    activeSlotRef,
    slotRunning,
    messages,
    send,
    steerMutation,
    composerRef,
    composerSlotRef,
    inputRef,
    setInput,
    stores: draftStores,
    staging,
    pendingQuestion,
    softStopAtMapRef,
    dispatch,
    onSlashRefused: reportSlashRefusal,
  })
  // The endpointer's auto-submit is an Enter press: the composer's default busy
  // decision for the active slot (never the flipped chord), so it steers where
  // Send would steer. Assigned in render so the voice callback (composerHost.ts) always
  // reaches the latest send() and steer().
  voiceSubmitRef.current = () => {
    const slot = activeSlotRef.current
    // send() owns the disconnected guard and upload hold, so route either state there before steer() can consume the composer.
    if (!connected || isComposerSendHeld(slot) || isComposerSendHeld(composerSlotRef.current)) { void send(); return }
    const flag = slot ? slotBusySteer(store.getState(), slot, jevAutoConsented) : undefined
    if (flag) steer(flag === 'auto' ? { auto: true } : undefined)
    else void send()
  }
  const {
    messageToDisplayIdx, navigateToTurn, chatNav, turnStepAnnouncement, chatPins, chatPinsLoading, isPinned, setPendingPinnedJump, handleEditLastRequest, handleJumpToPinnedMessage, handleJumpToQuote,
    handleJumpToPin, handleTogglePinForMessage, handleUnpinById, pinError, pinStatus, dismissPinStatus, messageToDisplayIdxRef,
  } = useTranscriptPins({
    embedded, dispatch, isMobile, activeSlot, messages, messagesRef, slotRunning, splitMode, crewWindow, slotHasMore, slotOldestIndex, cursorIsForActiveSlot, loadingOlder, activeViewIsBoundedPage,
    isWelcomeState, activeSlotRemoteBound, scrollerRef, search, navToDisplayIndex, pinnedJumpChrome, scrollToPinnedPrompt, setHighlightTs, splitFeatureEnabled, regenerating, setEditLast, editSeqRef,
    renderedDisplayItems, renderedTranscript,
  })
  // Search steps and clicks, the approval bar's "Show in chat", and ?msg= deep links.
  const { jumpToSearchResult } = useTranscriptJumps({
    search,
    messages,
    messageToDisplayIdx,
    messageToDisplayIdxRef,
    navToDisplayIndex,
    activeSlot,
    cursorIsForActiveSlot,
    slotHasMore,
    slotOldestIndex,
    initialMsgRef,
    initialMidRef,
    initialSidRef,
    setHighlightTs,
    handleJumpToPinnedMessage,
  })
  const {
    activeSlotTitle, renderMessage, renderTurnItem, renderFarmItem,
  } = useTranscriptRendering({
    embedded, mode, popout, filteredSlots, connected, activeSlot, voiceRecoverySlot, appToolCallIds, mcpAppPanel, messages, messagesRef, slotRunning, toolDisclosure, setToolDisclosureFor, slotState,
    activityOpen, slotHasMore, slotOldestIndex, cursorIsForActiveSlot, loadingOlder, chatConfig, activeSlotRemoteBound, automationId, setAutomationOpen, handleArtifactOpen, handleFileOpen,
    handleFolderOpen, handleOpenDiff, handleSubagentPanelOpen, sessionTitles, handleFork, highlightTs, selectSessionTab, linkPreviewsOn, socialShareOn, connectionsUiOn, planTaskId, showRefusedPress,
    approve, dismissApproval, revealAppInPanel, lastTextIdx, regenerating, handleRegenerate, continuable, continuing, freshSession, handleContinue, handleFreshSession, interrupted,
    openDefaultModelSetting, openKiroSignIn, openMemberCapabilities, openModelPickerFromError, openTurnLimitSetting, quoteWholeMessage, handleAsk, handleQuote, handleEditResend, editLast, farmPassRef,
    handleEditConsumed, renderUserContentCb, transcriptHot, toggleAct, handleSpeak, handleApplyPlan, renderedDisplayItems, stableMsgKey, handleLoadEarlier, isPinned, handleJumpToQuote,
    handleTogglePinForMessage,
  })
  const {
    mobileSessions, drawerMounted, drawerX, drawerPanelRef, drawerScrimRef, sideOverlayX, sideOverlayPanelRef, sideOverlayPhase, drawerScrim, openSidebar, closedSessionActions, sidebarFolderActions,
    closeSidebar, chatContainerRef, containerH, activitySlot, hasTaskDashboard, sidePanelWantsMount, inlineSidePanelShowing, drawerDragging, revealSourceLink, previewExpanded, sidebarOpen,
    sidebarOnScreen, flyoutTriggerRef, flyoutSurfaceRef, flyoutEligible, flyout, expandFrom, expandSidebar,
  } = useSessionsDrawer({
    embedded, embedMode, dispatch, navigate, navigationType, location, isMobile, filteredSlots, activeSlot, splitMode, crewWindow, activityOpen, showActionError, githubSourceHostsRef, hasBrowserTab,
    hasLiveAppTab, jiraSourceHostsRef, search, selectSource, setRevealedSources, sourceHostsRef, tabsCtl, drawerPopRef, chatFolders, setSidebarPinned, sidebarPinned, sidebarPinnedRef,
    sidebarAutoHidden, toggleAct,
  })
  const flyoutSwitch = useCallback((key: string) => {
    // User gesture on a listed session row (collapsed-sidebar flyout): the
    // announced class, same as the expanded sidebar's own rows.
    dispatch(switchSlot({ key, announceOnMissing: true }))
    setSplitMode(false)
    flyout.close()
  }, [dispatch, flyout, setSplitMode])
  const {
    flyoutNew, panelReserve, panelMaximized, panelFillWidth, mobileSessionsToggle, topbarSessionsToggle, mobileNewSessionItem, switchMemoryMode, showComposerMemoryChip, memorySwitching, composerOptimizing, handleOptimizingChange,
  } = usePanelLayout({
    mode, dispatch, isMobile, filteredSlots, activeSlot, isWelcomeState, showActionError, currentSlot, chatFolders, chatFoldersError, chatFoldersLoaded, mobileNewSessionBusy,
    mobileNewSessionInFlightRef, setMobileNewSessionBusy, setSidebarPinned, sidebarPinned, railWidth, winW, effectiveSidebarWidth, mobileSessions, openSidebar, closeSidebar, previewExpanded,
    sidebarOpen, flyout, memorySwitch: { store: boundStore, composerSlotRef, inputRef, pendingFilesRef, pasteBlocksRef, pendingSessionsRef, drafts, fileDrafts, pasteDrafts, sessionRefDrafts, pickedFileTokens, saveDrafts, setActionError, composerMountedRef, lockRef: memorySwitchingRef },
  })

  // The band ChatInput renders above the composer, and the session-control chips.
  const composerAbove = useComposerAboveBand({
    langGen,
    controls: sessionControlState,
    folderSuggestion,
    activeSlot,
    sidebarOnScreen,
    folderSuggestionAccept,
    folderSuggestionDecline,
    activeTip,
    dismissTip,
  })
  const composerSessionControls = useSessionControlChips({ sessionControls, openSessionControl, activeSlot, sessionControlStatuses })
  // The two icon-only controls at the header bar's right end look alike, so
  // each shows its own aria-label in an InstantTip on hover or focus, at once,
  // instead of a native title the browser holds back for about a second.
  const popOutTip = useLabelTip(i18nT('pages.chatPage.pop_out_session_to_its_own_window'))
  const activityTip = useLabelTip(i18nT('pages.chatPage.open_activity_panel'))

  return (
    <RunInTerminalScope.Provider value={runInTerminalScope}>
    <RowDisclosureProvider resetKey={activeSlot}>
    {/* The side panel can dock below the chat only while the shell's activity
        bar hosts it; the inline panel (mobile, embed, popout) always opens
        right, so every panel glyph on this page resolves against that. */}
    <SidePanelDockHost value={!!activitySlot}>
    <TagPopoverProvider>
    {/* Self-hosted Jira allowlist for every markdown anchor in the page --
        message bodies, previews, and panels alike -- so a pasted Jira URL
        chips identically wherever it renders. Cloud URLs need no provider. */}
    <JiraHostsCtx.Provider value={jiraSourceHosts}>
    <SidebarFolderCtx.Provider value={sidebarFolderActions}>
    <ClosedSessionCtx.Provider value={closedSessionActions}>
    <div
      ref={chatContainerRef}
      /* Both sides are this page's own: a rightward drag opens the sessions
         drawer and a leftward one the activity panel, so the app-wide nav
         gesture bound on the shell must not also arm here. Declared on the SAME
         element the two instances below bind, which is what lets them read the
         claim as their own and proceed.

         Withheld when `embedded`, because that is exactly when this page binds
         NOTHING (both instances are gated on `!embedded`) — and an embedded chat
         renders INSIDE the shell (the artifact companion, the Papyrus co-author
         panel, an app SDK panel), at full width on mobile. A claim that outlives
         its ownership there suppressed the nav swipe while serving nothing: a
         dead gesture across the whole screen, on the chat-shaped surface where
         the gesture was most likely to be tried. The claim has to track what is
         actually bound, or the fail-open default is defeated by the one page
         that declares.

         Not also gated on `isMobile`: the app-wide instance is mobile-only, so a
         desktop claim suppresses nothing, and adding the term would imply this
         attribute carries a guarantee about a case it cannot affect. */
      data-owns-swipe={embedded ? undefined : 'left right'}
      className="flex flex-1 min-h-0 h-full overflow-hidden relative"
      /* Published here, not on the chat pane, because the side panel (Activity,
         Browser, SideChat's composer and follow-up chips) is this element's
         child and the chat pane's SIBLING. Anything that reads the setting via
         `var(--mc-message-font-size, 14px)` from inside the panel would
         otherwise silently take the fallback and look right at the default
         only. Content width stays on the pane: it is a column geometry, and the
         panel has its own. */
      style={{ '--mc-message-font-size': `${chatConfig.messageFontSize}px` } as React.CSSProperties}
    >
      <AnimatePresence>
        {isMobile && drawerMounted && (
          <motion.div
            key="sessions-backdrop"
            data-testid="sessions-backdrop"
            className="fixed inset-0 z-[46] bg-black/50 backdrop-blur-xs"
            // ^ Frosted, matching every other scrim in the app (App.tsx's own
            // mobile nav backdrop is the same three classes). Kept adjacent to
            // `key` — the composer-chrome occlusion guard anchors its z-order
            // regex on that proximity. A full-viewport `backdrop-filter` does
            // re-sample its backdrop on every repaint behind it — which under
            // a streaming message list is every frame — and both alternatives
            // were tried and rejected on how they LOOK: dropping it entirely,
            // and deferring it to the settled state (the blur arriving after
            // the panel had stopped read as a second event).
            ref={drawerScrimRef}
            // The margins inset this fixed box to the VISIBLE band: inset-0 is
            // the whole layout viewport, which a keyboard shrinks on Chromium
            // but not on iOS Safari, so an unmodified scrim keeps its full
            // height there and the drawer's lower half sits behind the keyboard
            // with nothing dimmed under it. Insetting rather than restating the
            // edges is what lets every safe-area class keep owning its own edge,
            // here and on the panel below.
            style={{ opacity: drawerScrim, marginTop: vv.offsetTop, marginBottom: keyboardInset }}
            // Ignored while a drag owns the panel: the release that ends a
            // close gesture lands here as a click, and treating it as a
            // tap-to-dismiss would run a second close over the settle.
            onClick={() => { if (!drawerDragging) closeSidebar() }}
          />
        )}
      </AnimatePresence>
      {/* Sidebar toggle — absolute in the stable container in BOTH states
          (only the icon flips), so collapsing cannot drag it sideways with
          the reflowing content pane. The collapse/expand motion itself is the
          panel deforming into/out of this button's rect (OverlayDrawer morph
          mode, morphTarget below). Desktop, non-embed, with sessions only.
          While collapsed, hovering it opens the recents flyout below; clicking
          hands that flyout's rect to the drawer so the panel grows out of it. */}
      {!isMobile && embedMode !== 'chat' && embedMode !== 'sessions' && filteredSlots.length > 0 && (
        <button
          type="button"
          onClick={() => expandSidebar(flyout.open)}
          {...flyout.triggerProps}
          {...uiLocation('chat.sessions-sidebar-toggle', flyoutTriggerRef)}
          aria-haspopup={flyoutEligible ? 'menu' : undefined}
          aria-expanded={flyoutEligible ? flyout.open : undefined}
          // Geometry mirrored by TOGGLE_RECT (chat/SessionFlyout) — every
          // surface in this interaction grows out of and back into this rect.
          // In split view the grid's top-left pane reserves this column
          // (SessionGridView `leading`); its title row is the same height as
          // the single-chat row, so the toggle keeps this rect there too.
          className="pi-morph absolute top-[9px] left-2 z-[61] w-7 h-7 rounded-md flex items-center justify-center cursor-pointer text-muted hover:text-text hover:bg-bg-hover transition-colors bg-transparent border-none"
          title={sidebarOpen ? i18nT('pages.chatPage.hide_sessions') : i18nT('pages.chatPage.show_sessions')}
          aria-label={sidebarOpen ? i18nT('pages.chatPage.hide_sessions_sidebar') : i18nT('pages.chatPage.show_sessions_sidebar')}
        >
          {sidebarOpen ? <PanelLeftLight size={16} /> : <PanelLeftSolid size={16} />}
        </button>
      )}
      <AnimatePresence>
        {flyoutEligible && flyout.open && (
          <SessionFlyout
            key="session-flyout"
            ref={flyoutSurfaceRef}
            slots={filteredSlots}
            activeSlot={activeSlot}
            unreadSlots={surfaceUnreadSlots}
            // The flyout is a session list, which gains nothing past
            // SIDEBAR_MAX; the last reported width may be a board view's.
            panelWidth={Math.min(effectiveSidebarWidth, SIDEBAR_MAX)}
            // The panel's own height (OverlayDrawer carries pb-2), so the
            // flyout can never be taller than the thing it grows into.
            maxHeight={Math.max(0, containerH - 8)}
            connected={connected}
            creating={creatingSlot}
            autoFocus={flyout.openedBy === 'keyboard'}
            onSwitch={flyoutSwitch}
            onNew={flyoutNew}
            onExpand={() => expandSidebar(true)}
            onDismiss={() => { flyout.close(); flyoutTriggerRef.current?.focus() }}
            onMouseEnter={flyout.surfaceProps.onMouseEnter}
            onMouseLeave={flyout.surfaceProps.onMouseLeave}
            onBlur={flyout.surfaceProps.onBlur}
          />
        )}
      </AnimatePresence>
      {embedMode === 'chat' ? null : embedMode === 'sessions' ? (
        <div className="flex-1 min-w-0 h-full overflow-hidden [&_.sidebar-inner]:!w-full [&_.sidebar-inner]:!border-0 [&_.sidebar-inner]:!rounded-none [&_.sidebar-inner]:!shrink [&_.sidebar-inner]:!bg-bg [--folder-row-sticky-bg:var(--bg)] [&_.sidebar-resize-handle]:!hidden">
          <ChatSidebar
            slots={filteredSlots}
            activeSlot={null}
            unreadSlots={surfaceUnreadSlots}
            history={history}
            historyHasMore={historyHasMore}
            defaultAgent={defaultAgent}
            installedAgents={installedAgents}
            rowAgents={sidebarAgents}
            mode={mode}
            onWidthChange={setSidebarWidth}
            onDragChange={setSidebarDragging}
            fillsHost
            onSelectSlot={navigateToEmbeddedSlot}
            onOpenPeerSession={openEmbeddedCrewWindow}
          />
        </div>
      ) : (
      // The sessions sidebar's collapse owner (desktop) and the phone's
      // sessions drawer owner: a guide's reveal step completes the moment
      // this says open. Outside the drawer, so "closed" is said while the
      // drawer's contents are unmounted.
      <GuideRevealScope id={isMobile ? 'chat.sessions-drawer' : 'chat.sessions-sidebar'} open={sidebarOpen}>
      <OverlayDrawer open={isMobile ? drawerMounted : sidebarOpen} width={isMobile ? Math.max(0, winW - DRAWER_UNCOVERED_PX) : effectiveSidebarWidth} dragging={sidebarDragging} slideX={isMobile ? drawerX : undefined} slideRef={drawerPanelRef}
        // Mobile only: the same visible-band inset the scrim above carries, so the
        // two surfaces move together. Margins rather than restated edges is what
        // matters here: top-safe-offset-[42px] and bottom-safe compose env() insets
        // no script can read, so the panel could not express its own top/height in
        // JS without a calc(env(…)) string. With both edges pinned and height auto
        // the box is over-constrained on the block axis, so the used height is the
        // viewport minus both safe insets AND both margins — the top edge lands at
        // the visible top and the bottom edge just above the keyboard. Both terms
        // are 0 at rest, so the resting panel is unchanged; and where the layout
        // viewport window.innerHeight reports disagrees with the fixed positioning
        // viewport, the bottom margin merely under-insets — today's behaviour.
        //
        // Horizontal channels are untouched: left-safe stays on the className and
        // OverlayDrawer applies width and the x slide AFTER this style, so neither
        // can be overridden from here.
        slideStyle={isMobile ? { marginTop: vv.offsetTop, marginBottom: keyboardInset } : undefined}
        // Top edge: below the shell's bar while this page still draws its own
        // title row under that bar, so the two bars stay visible above the
        // panel; with the row IN the shell's bar (`titleInTopbar`) the panel
        // covers the whole safe-area height like the App nav drawer it
        // replaces on this route -- the rail's brand mark then sits where
        // that drawer's did. Close: scrim tap, swipe, Back -- all unchanged.
        morph={!isMobile} morphTarget={TOGGLE_RECT} expandFrom={expandFrom} contentH={Math.max(0, containerH - 8)} className={isMobile ? `mobile-sessions-overlay fixed ${titleInTopbar ? 'top-safe' : 'top-safe-offset-[42px]'} bottom-safe left-safe z-50 bg-bg-elevated !py-0 rounded-r-xl shadow-lg [&>*]:!rounded-none [&>*]:!border-0 [&>*]:!m-0` : ''}>
        {/* Phone chat page: ONE drawer holds the shell's navigation rail (72px,
            from MobileNavRailContext) beside the sessions pane, Discord-style, so
            the bar above needs no second drawer trigger. The pane keeps its
            `staticRows` content and takes the drawer's remaining width; the
            drawer's own width, slide, scrim and keyboard inset are unchanged.
            Row taps that stay on this page close the drawer (`closeSidebar`);
            rows that leave it `replace` the duplicate history entry
            `pushDrawerEntry` minted, so Back lands on the chat. */}
        {(() => {
        const sessionsPane = (
        <ChatSidebar
          slots={filteredSlots}
          activeSlot={activeSlot}
          unreadSlots={surfaceUnreadSlots}
          history={history}
          historyHasMore={historyHasMore}
          defaultAgent={defaultAgent}
          installedAgents={installedAgents}
          rowAgents={sidebarAgents}
          mode={mode}
          onWidthChange={setSidebarWidth}
          onDragChange={setSidebarDragging}
          fillsHost={isMobile}
          collapsible={!isMobile}
          staticRows={isMobile}
          onSelectSlot={clearSplitOnSelect}
          onOpenSlotInNewTab={ownsSessionTabs ? openSlotInNewTab : undefined}
          onOpenSource={revealSourceLink}
          // Only offer the pane as a drop target when a composer exists to show
          // the chip — see canStageSessionRef for why this is a named predicate.
          chatDropTarget={canStageSessionRef ? chatPaneEl : null}
          onDropSessionRef={stageSessionRef}
          // Desktop-only by design (the narrow-viewport-required exemption):
          // the scroll peek draws a clipped title in full past the sidebar's
          // edge, over the chat beside it. On a phone the sessions pane is a
          // near-full-width drawer with no chat beside it, so titles are not
          // clipped by a narrow sidebar and there is nothing to draw over; the
          // full title stays reachable there through the row's title tooltip
          // and the rename box.
          scrollPeek={!isMobile}
        />
        )
        return isMobile && mobileNavRail ? (
          <div className="flex h-full min-h-0 w-full" data-testid="mobile-split-drawer">
            {mobileNavRail({ onActivate: closeSidebar })}
            {/* The pane sits on the drawer's elevated surface so it reads apart
                from the rail's `bg-bg-accent` (the sidebar's own shell paints
                `bg-bg`, one step too close to the rail on the light themes). */}
            {/* The drawer's `[&>*]` resets (no card border/radius/margin on the
                sidebar root) reach only its direct child, which is now this
                wrapper -- so the wrapper carries the same resets one level down. */}
            <div className="flex-1 min-w-0 h-full min-h-0 flex flex-col overflow-hidden bg-bg-elevated [&_.sidebar-inner]:!bg-bg-elevated [&_.sidebar-inner]:!w-full [&_.sidebar-inner]:!min-w-0 [&_.sidebar-inner]:!shrink [&>*]:!rounded-none [&>*]:!border-0 [&>*]:!m-0">{sessionsPane}</div>
          </div>
        ) : sessionsPane
        })()}
      </OverlayDrawer>
      </GuideRevealScope>
      )}
      <MobileTopBar
        topbarSlot={topbarSlot}
        topbarTrailSlot={topbarTrailSlot}
        embedMode={embedMode}
        topbarSessionsToggle={topbarSessionsToggle}
        activeSlot={activeSlot}
        splitMode={splitMode}
        splitFeatureEnabled={splitFeatureEnabled}
        title={title}
        editingTitle={editingTitle}
        setEditingTitleSlot={setEditingTitleSlot}
        showActionError={showActionError}
        setActionError={setActionError}
        currentSlot={currentSlot}
        sidebarAutoHidden={sidebarAutoHidden}
        openSidebar={openSidebar}
        effectiveMode={effectiveMode}
        sidebarOnScreen={sidebarOnScreen}
        activePoppedOut={activePoppedOut}
        focusActivePopout={focusActivePopout}
        openActivePopout={openActivePopout}
        activityOpen={activityOpen}
        toggleAct={toggleAct}
        splitAnchorForActive={splitAnchorForActive}
        activeIsSplitAnchor={activeIsSplitAnchor}
        enterSplit={enterSplit}
        mobileNewSessionItem={mobileNewSessionItem}
        onPromote={handlePromote}
        dispatch={dispatch}
      />

      {/* Per-slot tag picker — a single connected popover, opened from any session
          menu (sidebar row or header) via the ChatPage-scoped TagPopover context. */}
      <SlotTagPopover />
      <ComposerDraftSync store={composerDraft} inputRef={inputRef} onCommit={onComposerDraftCommit} />

      {/* Chat pane */}
      {embedMode !== 'sessions' && (
      <div ref={setChatPaneEl} className={`relative flex flex-col bg-bg min-w-0 min-h-0 h-full overflow-hidden ${(activityOpen && !activitySlot) || search.isOpen ? 'flex-[1_1_60%]' : 'flex-1'}`} style={{ transition: 'flex 0.2s', ...(!sidebarOpen && !isMobile ? { marginLeft: -COLLAPSED_PANE_RECLAIM_PX } : {}), '--mc-content-width': scaleContentWidth(CONTENT_WIDTH[chatConfig.contentWidth], chatConfig.contentWidth, chatConfig.messageFontSize).messages, '--mc-input-width': scaleContentWidth(CONTENT_WIDTH[chatConfig.contentWidth], chatConfig.contentWidth, chatConfig.messageFontSize).input } as React.CSSProperties}>
        {crewWindow && (
          <div className="absolute inset-0 z-[48] bg-bg" data-crew-cover>
            <Suspense fallback={<CrewWindowGuard onClose={embedded ? () => navigate('/embed/sessions') : undefined} />}>
              <CrewChatWindow key={`${crewWindow.instanceId}:${crewWindow.key}`} target={crewWindow}
                onClose={embedded ? () => navigate('/embed/sessions') : undefined} />
            </Suspense>
          </div>
        )}
        {snipFrame && (
          <SnipOverlay
            frame={snipFrame}
            onComplete={handleSnipComplete}
            onCancel={handleSnipCancel}
            onError={setUploadError}
          />
        )}
        <ChatPaneNotices
          uploadHint={uploadHint}
          setUploadHint={setUploadHint}
          uploadError={uploadError}
          setUploadError={setUploadError}
          sidError={sidError}
          setSidError={setSidError}
          sidMatches={sidMatches}
          setSidMatches={setSidMatches}
          openShortNameMatch={openShortNameMatch}
          activeSlot={activeSlot}
          provider={provider}
          selectionCapabilitiesQ={selectionCapabilitiesQ}
          chipDefault={chipDefault}
          actionError={actionError}
          setActionError={setActionError}
          switchSlotGone={switchSlotGone}
          setVoiceRecoverySlot={setVoiceRecoverySlot}
          pinError={pinError}
          pinStatus={pinStatus}
          dismissPinStatus={dismissPinStatus}
          unresumableResume={unresumableResume}
          undeletableHistory={undeletableHistory}
          dispatch={dispatch}
        />
        {/* Floating sessions opener — mobile only, and only on a chat with
            nothing in it yet (a conversation gets the in-header control
            instead). Suppressed while the inline side panel is showing: it is
            `fixed` at the same top-left corner as the panel's own collapse
            button and, carrying z-10 against that button's auto z-index, paints
            OVER it — leaving no way to close a panel that covers the whole
            screen. It would also be pointing at a chat pane the panel has
            squeezed to zero width. Sessions stay reachable meanwhile via the
            rightward drag (useDrawerSwipe above).

            Suppressed when EMBEDDED for the same reason it is suppressed
            behind the side panel: `fixed` anchors it to the VIEWPORT, not to
            the host's pane, so it lands on whatever the host put in that
            corner -- in Papyrus, on the toolbar's back button, giving two
            overlapping tap targets on the app's primary exit. A host that
            embeds one scoped conversation has no sessions list to open. */}
        {isMobile && !embedded && !sidebarOpen && !inlineSidePanelShowing && !titleInTopbar && !(activeSlot && (messages.length > 0 || slotRunning)) && (
          <div className="fixed top-safe-offset-[42px] left-safe ml-2 z-10">
            <button className="mc-touch-hit p-2 rounded-lg text-muted hover:text-text bg-bg-elevated border border-border shadow-sm cursor-pointer" onClick={openSidebar} aria-label={i18nT('pages.chatPage.toggle_sessions')}>
              {/* Same glyph as the desktop toggle: a control is named by the SURFACE
                  it opens, and this opens the sessions panel. Solid rather than
                  `PanelLeftLight` because this form only renders while that panel is
                  closed. It carries no conversation-mode variant -- mode belongs to
                  the conversation, not to the drawer, and the header's own mode
                  control already shows it. */}
              <PanelLeftSolid size={18} />
            </button>
          </div>
        )}
        {/* Open-sessions strip. ABOVE the session title row, not inside the
            transcript column: the title row is an absolute overlay anchored to
            that column, so a strip inserted inside it would be painted over.
            Sitting here it pushes the whole column down instead, and the
            transcript (flex: 1) gives up exactly the strip's height.

            Renders nothing below two tabs (see SessionTabStrip), so a user who
            never opens a second tab sees the surface unchanged. Suppressed in
            split view, which does its own tiling and shows every open session
            at once, and on every EMBEDDED host (`ownsSessionTabs`) — the same
            predicate that stops those hosts owning the persisted set, so the
            strip and the set can never disagree about whose surface this is. */}
        {activeSlot && ownsSessionTabs && !(splitMode && splitFeatureEnabled) && (
          // no-drag: on the desktop shell the top strip of the window is the
          // titlebar drag region, and a tab you cannot click is worse than no tab.
          //
          // While the desktop sidebar is collapsed the shell insets the strip
          // past the stationary toggle, gliding on the same 240ms curve as the
          // panel morph and the title row so the tabs do not jump at the start
          // of the slide. The shell owns the strip's bottom divider (the strip
          // draws none of its own): an inset border on the strip's root would
          // stop short of the gutter and leave a notch under the toggle, so
          // the shell draws one continuous hairline across the full width.
          // `empty:hidden` keeps the shell out of the layout when the strip
          // renders nothing (fewer than two tabs), so the divider it owns
          // appears only when the strip does.
          <div
            className="empty:hidden border-b border-border transition-[padding-left] duration-[240ms] [transition-timing-function:cubic-bezier(.32,.72,0,1)]"
            style={{
              WebkitAppRegion: 'no-drag',
              paddingLeft: !sidebarOpen && !isMobile ? COLLAPSED_SESSION_TABS_INSET : 0,
            } as React.CSSProperties}
          >
            <SessionTabStrip
              tabs={sessionTabs.tabs}
              activeKey={activeSlot}
              cue={sessionTabs.cue}
              connected={connected}
              onSelect={selectSessionTab}
              onClose={closeSessionTab}
            />
          </div>
        )}
        {splitMode && splitFeatureEnabled ? (
          <SessionGridView
            seedSlot={splitAnchor ?? activeSlot}
            openSideChat={connected ? openSideChatForPane : undefined}
            // The single-chat title row is not rendered in split view, so the
            // grid's top-left pane stands in for it: on desktop it clears the
            // shell's stationary toggle while the sidebar is collapsed (the
            // same columns the title row's 'pl-[60px]' rule reserves, measured
            // from the pane's own edge); on mobile it carries the sessions
            // toggle inline.
            leading={
              isMobile
                ? (embedMode !== 'chat' && !titleInTopbar ? { control: mobileSessionsToggle } : undefined)
                : (embedMode !== 'chat' && embedMode !== 'sessions' && filteredSlots.length > 0 && !sidebarOpen ? { inset: true } : undefined)
            }
            onFileOpen={handleFileOpen}
            onClose={() => setSplitMode(false)}
            onCollapse={(slot, anchorTs, anchorMid) => {
              // User gesture on a session reference (split-pane collapse): the
              // announced class.
              dispatch(switchSlot({ key: slot, announceOnMissing: true }))
              setSplitMode(false)
              // switchSlot.pending sets activeSlot synchronously, so the pending-jump
              // effect pages back to the anchor instead of landing on the newest turn.
              if (anchorTs) setPendingPinnedJump({ slotKey: slot, messageTs: anchorTs, mid: anchorMid, origin: 'earlier' })
            }}
          />
        ) : !activeSlot ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
            <EmptyState icon={<MessageSquare className="lucide-inline" />} title={i18nT('pages.chatPage.what_can_i_do_for_you')} subtitle={i18nT('pages.chatPage.start_a_new_chat_to_begin')} />
            <Btn
              primary
              disabled={newSlotMutation.isPending}
              {...uiLocation('chat.start-new-chat')}
              onClick={() => {
                if (newSlotFailed) {
                  // Re-arm before state updates can let auto-selection run.
                  newSessionRef.current = true
                  setNewSlotFailed(false)
                  setSidError('')
                  newSlotMutation.mutate()
                  return
                }
                dispatch(createSlot({ agent: pendingAgent || undefined, agent_kind: pendingAgent ? pendingAgentKindRef.current : undefined, model: pendingModel || undefined, mode }))
              }}
            >
              {i18nT('pages.chatPage.start_a_new_chat')}
            </Btn>
          </div>
        ) : (
          <SearchHighlightContext.Provider value={searchCtxValue}>
          <div className="relative flex flex-col flex-1 min-h-0" {...dropTargetProps}>
            {/* Claude-style title row — absolute overlay, solid top fading to transparent.
                Inset on the right by the 6px scrollbar width (see ::-webkit-scrollbar
                in index.css) so the overlay never paints over the scroller's scrollbar
                track — otherwise the thumb is hidden/un-grabbable when scrolled to top. */}
            {/* z-[45] at rest keeps this row BELOW the mobile drawer scrim
                (z-[46]) so an open sessions drawer dims it. While it hosts the
                rename editor it lifts to z-[47], above the composer status bars
                (z-[46]): those are flex-flow chrome, not overlays, and they rise
                into this band once the transcript scroller collapses to zero —
                what a phone keyboard does — where they painted over the caret.
                Scoping the lift to the edit is safe because opening the drawer
                blurs the input, which commits and closes the editor. */}
            <div className={`absolute top-0 left-0 right-1.5 ${editingTitle ? 'z-[47]' : 'z-[45]'} pointer-events-none`} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} {...{ [SELECTION_INERT_ATTR]: '' }}>
              {/* The row's left padding GLIDES between its open (20px) and
                  collapsed (60px, clearing the stationary toggle + divider)
                  values on the same 320ms curve as the panel — an instant
                  class flip here reads as the title jumping sideways at the
                  start of the slide. */}
              {/* Phone: the shell's single bar hosts this row (the portal above),
                  so the inline copy stands down. The fold sentinel, the pinned
                  prompt and the header fade stay: they belong to the transcript
                  column, not to the bar. */}
              {!titleInTopbar && (
              <div className={`relative pr-1.5 pt-[9px] pb-2 flex items-center gap-2 bg-bg pointer-events-none transition-[padding-left] duration-[240ms] [transition-timing-function:cubic-bezier(.32,.72,0,1)] ${!isMobile && embedMode !== 'chat' && filteredSlots.length > 0 && !sidebarOpen ? 'pl-[60px]' : isMobile ? (embedMode === 'chat' ? 'pl-4' : 'pl-3') : 'pl-5'}`}>
                {/* Divider between toggle and title — ALWAYS mounted and
                    absolute (zero width, no flex-gap participation) so it can
                    never change the row's layout; it rides the row (title
                    side) and only fades. left-[52px] = the collapsed pane's
                    view of container x 44 (button 8+28 + 8px gap). */}
                {!isMobile && embedMode !== 'chat' && filteredSlots.length > 0 && (
                  <span aria-hidden="true" className={`absolute left-[52px] top-[13px] w-px h-5 bg-border transition-opacity ${sidebarOpen ? 'opacity-0 duration-100' : 'opacity-100 duration-150 delay-[90ms]'}`} />
                )}
                {embedMode !== 'chat' && isMobile && mobileSessionsToggle}
                <div className="group/header flex min-w-0 items-stretch gap-0.5 pointer-events-auto">
                <div className="flex items-center rounded-l-md rounded-r-[2px] px-1.5 py-0.5 group-hover/header:bg-bg-hover transition-colors">
                <ChatHeaderMenu
                  activeSlot={activeSlot}
                  agent={currentSlot?.agent}
                  onReveal={activeSlot && embedMode !== 'chat' ? () => {
                    // The request rides the store, not a window event: with the
                    // drawer collapsed ChatSidebar is unmounted, so an event
                    // dispatched here (before the mount that setSidebarPinned
                    // schedules commits) had no listener and was dropped —
                    // the store entry survives until the sidebar consumes it
                    // (#912). Mobile drives its own drawer state. Embed-chat
                    // never mounts a sidebar, so the item is not offered there:
                    // a stored request would outlive the view and fire on
                    // whichever sidebar mounts next.
                    sidebarAutoHidden.current = null
                    if (isMobile) openSidebar()
                    else if (!sidebarPinned) setSidebarPinned(true)
                    dispatch(requestSlotReveal(activeSlot))
                  } : undefined}
                  onRename={activeSlot ? () => setEditingTitleSlot(activeSlot) : undefined}
                  mode={effectiveMode}
                  sidebarOnScreen={sidebarOnScreen}
                  newSessionHere={embedMode !== 'chat' && isMobile ? mobileNewSessionItem : undefined}
                  memoryMode={currentSlot?.memory_mode}
                  onPromote={handlePromote}
                />
                </div>
                {/* Shared with every split-view pane header (#9727). The editor
                    flag stays here, pinned to the slot it opened on. */}
                {activeSlot && (
                  <SessionTitleControl
                    slotKey={activeSlot}
                    title={title}
                    editing={editingTitle}
                    onEditingChange={open => setEditingTitleSlot(open ? activeSlot : null)}
                    onError={showActionError}
                    onAttempt={() => setActionError(null)}
                  />
                )}
                </div>
              <InboundLinkChip slotKey={activeSlot} />
              {/* Trailing controls grouped under a single ml-auto so multiple
                  right-aligned items don't each absorb free space (two ml-auto
                  siblings split the gap, parking the split icon mid-header). */}
              {/* focus-caption-reserve: this group owns the window's top-trailing
                  corner — where Windows and frameless Linux paint their caption
                  controls — whenever the side panel is not holding that edge, i.e.
                  while it is closed (the state that renders the reopen toggle
                  below) or docked at the bottom. Right-docked and showing, the
                  panel is at that edge instead and carries the reserve itself, so
                  reserving here too would indent these controls for nothing. */}
              <div className={`ml-auto flex shrink-0 items-center gap-1.5 pointer-events-none${!sidePanelWantsMount || sidePanelDock === 'bottom' ? ' focus-caption-reserve' : ''}`}>
              {/* Pop-out control, promoted to the title bar (menu items remain for
                  sidebar parity). Mirrors the split-view pattern to its left: a
                  dimmed icon to act, an accent chip when the state is active.
                  Inside the popout window itself the same spot carries Return. */}
              {popout ? (
                <Clickable className="flex items-center gap-1 text-muted hover:text-text transition-colors cursor-pointer pointer-events-auto text-[11px] font-medium px-1.5 py-0.5 rounded hover:bg-bg-hover" onClick={returnSelfToMain} title={i18nT('pages.chatPage.return_this_session_to_the_main_window')} aria-label={i18nT('pages.chatPage.return_to_main_window')}>
                  <Undo2 size={13} /> {i18nT('pages.chatPage.return')}
                </Clickable>
              ) : !embedMode && activeSlot && (activePoppedOut ? (
                <Clickable className="flex items-center gap-1 text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer pointer-events-auto text-[11px] font-medium px-1.5 py-0.5 rounded" onClick={() => focusActivePopout(activeSlot)} title={i18nT('pages.chatPage.this_session_is_open_in_its_own_window_focus_it')} aria-label={i18nT('pages.chatPage.focus_popped_out_window')}>
                  <ExternalLink size={13} /> {i18nT('pages.chatPage.popped_out')}
                </Clickable>
              ) : (
                <Clickable className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-bg-hover transition-colors bg-transparent border-none cursor-pointer shrink-0 text-muted hover:text-text pointer-events-auto" onClick={() => openActivePopout(activeSlot, currentSlot?.title)} aria-label={i18nT('pages.chatPage.pop_out_session_to_its_own_window')} {...popOutTip.handlers}>
                  <ExternalLink size={15} />
                  {popOutTip.bubble}
                </Clickable>
              ))}
              {/* Activity panel open toggle — relocated here from the top bar
                  (item 2.4) so opening the panel no longer narrows the now
                  full-width header. Shown only while the panel is closed; the
                  panel's own header carries the close button. Never disabled:
                  below the mobile breakpoint the panel opens full width, at or
                  above it opens beside the chat. There is no width at which
                  the button does nothing. */}
              {!embedMode && !popout && !activityOpen && (
                <Clickable
                  className="pi-morph flex items-center justify-center w-7 h-7 rounded-md transition-colors bg-transparent border-none shrink-0 pointer-events-auto text-muted hover:text-text hover:bg-bg-hover cursor-pointer"
                  onClick={toggleAct}
                  aria-label={i18nT('pages.chatPage.open_activity_panel')}
                  {...uiLocation('chat.side-panel-open')}
                  {...activityTip.handlers}
                >
                  <SidePanelGlyph size={15} />
                  {activityTip.bubble}
                </Clickable>
              )}
              {!embedMode && splitFeatureEnabled && (splitAnchorForActive && !activeIsSplitAnchor ? (
                <Clickable className="flex items-center gap-1 text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer pointer-events-auto text-[11px] font-medium px-1.5 py-0.5 rounded" onClick={() => enterSplit(splitAnchorForActive)} title={i18nT('pages.chatPage.this_session_is_open_in_a_split_return_to_it')} aria-label={i18nT('pages.chatPage.return_to_split_view')}>
                <Columns2 size={13} /> {i18nT('pages.chatPage.in_split')}
              </Clickable>
              ) : (
                <Clickable className="opacity-40 hover:opacity-100 transition-opacity cursor-pointer pointer-events-auto" onClick={() => enterSplit(activeSlot)} title={i18nT('pages.chatPage.split_view_d')} aria-label={i18nT('pages.chatPage.enter_split_view')}>
                <Columns2 size={14} />
              </Clickable>
              ))}
              </div>
              {/* Header fade — softens content passing up into the opaque title
                  row, so it hangs off that row's bottom edge (anchor="below":
                  as an in-flow sibling its 24px consumed layout and pushed the
                  pinned card that far off the header; out of flow it overlays
                  the transcript and the pinned card paints above it). */}
              <EdgeFade side="top" anchor="below" />
              </div>
              )}
              {/* Fold sentinel — zero-height, always mounted. Its top edge is the
                  line the pinned prompt sticks to (see updatePinnedPrompt). */}
              <div ref={pinFoldRef} aria-hidden className="h-0" />
              {/* Anchor the phone fade at the fold so its opaque edge stays behind
                  the card instead of masking the transcript below it. */}
              {titleInTopbar && (
                <div className="relative h-0">
                  <EdgeFade side="top" />
                </div>
              )}
              {pinned && (
                <PinnedPrompt
                  text={pinned.text}
                  fullText={pinned.full}
                  images={pinned.images}
                  bodyBeyondPreview={pinned.bodyBeyondPreview}
                  pushUp={pinned.push}
                  liveH={pinned.liveH}
                  maxH={pinned.maxH}
                  bannerH={pinned.bannerH}
                  expanded={pinExpanded}
                  onToggleExpanded={() => setPinExpanded(p => !p)}
                  onJump={() => scrollToPinnedPrompt(pinned.idx)}
                  cardRef={pinCardRef}
                  onCollapsedHeight={onPinCollapsedHeight}
                  promptKey={pinCandidateKey(pinned.idx, pinned.ts)}
                  scrollTranscriptBy={scrollTranscriptBy}
                />
              )}
            </div>
            <ChatDropOverlay active={dragOver} />
            {promoteConfirmDialog}
            {isWelcomeState ? (
              <motion.div
                key="welcome-hero"
                // `position`, not a full `layout`: the box now changes SIZE on
                // every dock resize (`marginBottom: dockH` below), and a full
                // layout animation would scale the greeting and cards through
                // each change -- the 0 -> dockH first measurement included --
                // instead of moving them. Position still animates.
                layout="position"
                // `isolate`: the hero is its own stacking context. WelcomeView
                // layers its cards with z-indexes of its own (a hovered card
                // grows over the next row at z-10, the Refresh link sits above
                // that at z-20). The dock root deliberately has no z-index, and
                // the composer inside it is z-10, so without a context here those
                // values compared against the composer's and the Refresh link
                // painted ON TOP of the input box. Inside its own context the
                // hero's z-indexes order only the cards against each other.
                // `safe center`: when the welcome column is taller than this
                // box (a phone, a short window), plain centring pushes its top
                // out of scroll reach; safe centring falls back to the start.
                className="isolate flex-1 flex flex-col items-center [justify-content:safe_center] gap-6 px-8 min-h-0 overflow-y-auto"
                // The hero's BOX ends above the dock (a margin, not padding
                // under it): the cards and the Refresh link are controls with
                // labels, and a label blurred under the glass reads as a glitch
                // and a tap there is ambiguous (maintainer ruling on #15820). A
                // column taller than the box scrolls inside it, never under the
                // dock; the memory-mode chip is part of the dock and so sits
                // below the box too.
                style={{ marginBottom: dockH }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <WelcomeView setInput={setInput} />
              </motion.div>
            ) : (
            <>
            {/* Speaks the turn an Alt+↑ / Alt+↓ step landed on. */}
            <span className="sr-only" aria-live="polite" aria-atomic="true">{turnStepAnnouncement}</span>
            <TurnNavigationMinimap
              items={chatNav.sections}
              scrollerRef={scrollerRef}
              onNavigate={navigateToTurn}
              // The rail maps loaded turns only; while the server holds older
              // rows its labels say "of N loaded" (#8221's disclosure).
              windowed={slotHasMore && cursorIsForActiveSlot}
              side={chatConfig.minimapSide}
            />
            <TranscriptScrollShell
              // The 64px spacer clears the inline title row; with the row in
              // the shell's bar (phone) the transcript starts at the top of the
              // column and the spacer would be a blank band under the bar.
              headerSpacer={!titleInTopbar}
              scrollerRef={scrollerRef}
              onScrollerElement={bindScroller}
              onScroll={onScrollPin}
              virt={virt}
              loadingOlder={loadingOlder}
              spinnerNearTop={spinnerNearTop}
              // The strip of the scroller the floating dock covers, plus
              // DOCK_CLEARANCE_PX, alongside TRANSCRIPT_TAIL_SPACER_PX. Unlike
              // the tail spacer this one also applies to a transcript short
              // enough not to scroll, so both are needed for the last line to
              // clear the dock in every state.
              // `visibility` is not one of the properties the shell claims, so
              // adding it here is inside its documented contract. Hiding rather
              // than unmounting keeps the scroller's geometry and the height
              // cache intact -- the restore needs to WRITE scrollTop while this
              // is up, which a display:none element cannot do.
              scrollerStyle={{ paddingBottom: dockH + DOCK_CLEARANCE_PX, ...(virt.restoreGate ? { visibility: 'hidden' as const } : null) }}
              aboveRows={<>
              {/* Mid-switch `slotHasMore` still describes the outgoing chat, so the cursor
                  key gates the bar to match the paging thunk's own precondition. */}
              {slotHasMore && cursorIsForActiveSlot && (
                <EarlierMessagesBar loading={loadingOlder} failed={olderFailed} onLoad={handleLoadEarlier} onFocusRelease={() => scrollerRef.current?.focus()} />
              )}
              </>}
              belowRows={<>
              {/* Off-screen measurement farm. Kept FIRST in `belowRows` — i.e.
                  after the rows and before the footer, exactly where it sat
                  before the scroll shell was extracted: it renders into a
                  zero-height overflow-hidden box, so its position only has to
                  be inside the transcript's own column (the width is what
                  makes the measurements true). */}
              <MeasureFarm
                enabled={!!activeSlot && !slotLoading}
                // NOT paused on slotRunning: a session with an agent working
                // is "running" for minutes at a stretch (tool executions),
                // and gating the farm on it disabled measured geometry on
                // exactly the sessions people actively read — every row they
                // scrolled to was estimate-priced and corrected under their
                // finger. Streaming regroups are safe: farmRecord revalidates
                // row identity at write time and drops stale writes.
                paused={loadingOlder}
                count={renderedDisplayItems.length}
                originIndex={visibleDisplayItems[0]?.index ?? Math.max(0, renderedDisplayItems.length - 1)}
                isMeasured={virt.farmIsMeasured}
                isMounted={virt.farmRowMounted}
                keyAt={(i) => { const it = renderedDisplayItems[i]; return it ? virtualKey(it, i) : null }}
                record={virt.farmRecord}
                renderItem={renderFarmItem}
                scrollerEl={() => scrollerRef.current}
              />
              {/* Footer */}
              <ChatFooter running={slotRunning} stopping={slotStopping} state={slotState} lastRole={lastRole} streamTick={streamTick} regenerating={regenerating} stopState={currentSlot?.stop_state} sendUnconfirmed={sendUnconfirmed} />
              {activeSlot && !slotLoading && !embedded && !popout && slotSwitchTarget !== activeSlot && (
                <div className="px-4 mx-auto w-full" style={{ maxWidth: 'var(--mc-content-width, 900px)' }}>
                  <SessionPulseSurveyCard
                    // Remount on session switch: without this, React reuses
                    // the same component instance across sessions, so an
                    // in-progress rating/feedback/email from session A would
                    // still be sitting in state when the user switches to
                    // session B and hits Submit — attributing A's answers to
                    // B's sessionId prop, which had already updated.
                    //
                    // Gated on !slotLoading: the card captures its baseline
                    // turn count on FIRST MOUNT (see the component's own
                    // comment), so mounting before history finishes loading
                    // would baseline at 0 and then count every loaded
                    // historical turn as "live" once the fetch resolves —
                    // reintroducing the exact reopened-session bug the
                    // baseline exists to prevent, just via a race instead of
                    // a missing check.
                    key={activeSlot}
                    sessionId={activeSlot}
                    kiroCrewVersion={kiroCrewVersion}
                    turnCount={completedTurnCount}
                    slotOrigin={currentSlot?.origin}
                    onLayoutChange={handleSurveyLayoutChange}
                  />
                </div>
              )}
              {/* Tail spacer, in px rather than vh. It plus the scroller's own
                  bottom padding is the clearance between the last line of the
                  transcript and the top of the floating composer dock, so
                  expressing it in `vh` made that clearance viewport-dependent: at
                  2vh + 8px it cleared by 1px at 844px tall and cut INTO the last
                  line on anything shorter (−1px at 740, −2px at 700, −5px at 560),
                  which is the sliced-glyph hairline reported from a phone and the
                  reason it looked mobile-only. */}
              <div style={{ height: TRANSCRIPT_TAIL_SPACER_PX }} />
              </>}
            >
              {/* Message items — only the mounted window renders; everything
                  else is represented by the top/bottom spacers. */}
              {visibleDisplayItems.map((vi) => {
                if (!vi.mounted) return null
                const item = vi.data
                const displayIdx = vi.index
                // A hidden invisible-only assistant row grouped as a loose
                // single (short quiet-cycle batches never wrap into a turn)
                // draws nothing in renderMessage; skip its measured py-1
                // wrapper too, or each quiet cycle leaves an empty spacer row.
                if (item.kind === 'single' && isHiddenInvisibleAssistantRow(item.msg)) return null
                if (item.kind === 'turn') {
                  return <div key={vi.key} ref={virt.measureRef(vi.index)} data-display-index={displayIdx}><TurnBlock turn={item} renderItem={renderTurnItem} collapseAll={chatConfig.collapseAllSteps} appToolCallIds={appToolCallIds} disclosure={turnDisclosure[vi.key]} disclosureKey={vi.key} onDisclosureChange={setTurnDisclosureFor} mayBeLive={turnRowMayBeLive} /></div>
                }
                // This row's bubble is the one the pinned banner is standing in for
                // (identity rule below): hide the row and mark it for index.css. The
                // marker reads `folding` while the hook reports the row's re-shown
                // action strip still UNCOVERED — some of it below the card's resting
                // bottom, on screen. That is the whole fold and the strip's own
                // height of scroll after it: the card rests at its clamp while the
                // strip, hanging under the bubble, is still sliding under it, so a
                // marker keyed on the fold alone dropped the strip out from under
                // the pointer for that last stretch. Once the strip is under the card
                // or behind the header the marker is empty and the strip hides with
                // its row again, or Tab would stop on controls nobody can see.
                const pinnedStandin = !!(pinned && (pinned.ts != null
                  ? (item.kind === 'single' && item.msg.ts === pinned.ts)
                  : pinned.idx === displayIdx))
                return <div key={vi.key} ref={virt.measureRef(vi.index)} data-display-index={displayIdx} className={`px-4 mx-auto w-full py-1`} data-pinned-standin={pinnedStandin ? (pinned?.stripUncovered ? 'folding' : '') : undefined} style={{
                  maxWidth: 'var(--mc-content-width, 900px)',
                  // The pinned banner is styled as this row's own bubble and sits
                  // at the exact position and width the bubble had when its top
                  // edge reached the fold, so leaving both visible is what betrays
                  // them as two containers. Hide the real one (visibility, NOT
                  // display — the virtualizer must keep measuring its height or
                  // the transcript would reflow under the reader) and the bubble
                  // appears to simply stop travelling and stick. The row hides the
                  // moment its top crosses the fold (the top-edge hand-off), and
                  // the card then folds down the BUBBLE's remaining height, so the
                  // row's action strip beneath the bubble is never behind the card
                  // — `data-pinned-standin` lets index.css re-show that strip
                  // (visibility is inherited, so a `visible` descendant of a hidden
                  // row is drawn and clickable). Without it a prompt taller than
                  // the viewport never shows its copy / copy-link / pin row at all:
                  // its bottom is only on screen once its top is above the fold.
                  //
                  // Match by message IDENTITY (ts), not display index. `pinned.idx`
                  // is computed in a scroll rAF against `displayItemsRef`, which is
                  // refreshed in a layout effect — but a streaming append or a turn
                  // regroup can still shift the list between that read and this
                  // render, leaving `pinned.idx` pointing one row off. When it did,
                  // the WRONG row was hidden and the real pinned bubble painted
                  // alongside the banner — the "two stacked boxes" bug. The ts is
                  // stable across any index shift, so it hides the right row every
                  // frame; fall back to the index only for a message with no ts.
                  visibility: pinnedStandin ? 'hidden' : undefined,
                }}>{item.kind === 'group' ? (() => {
                const unresolvedGroupPerms = item.msgs.filter(m => m.role === 'permission' && !m.meta?.resolved)
                if (item.msgs.every(m => m.role === 'permission')) return null
                return (
                <CollapsibleToolGroup
                  count={item.msgs.filter(m => m.role !== 'permission').length}
                  disclosureKey={`ctg-${vi.key}`}
                  hasPermission={false}
                  isRunning={slotRunning && displayIdx === renderedDisplayItems.length - 1}
                  permissionMeta={unresolvedGroupPerms.at(-1)?.meta as Record<string, unknown> | undefined}
                  pendingPermCount={unresolvedGroupPerms.length}
                  onApprove={(() => {
                    const aid = unresolvedGroupPerms.at(-1)?.meta?.approval_id as string | undefined
                    if (!aid) return approve
                    return async (action: string) => {
                      await api.resolveApproval(aid, toApiDecision(action))
                      dismissApproval(aid)
                    }
                  })()}
                  onViewActivity={toggleAct}
                  activityOpen={activityOpen}
                >{item.msgs.map((m, j) => <div key={msgIdentityKey(m, stableMsgKey)}>{renderMessage(item.startIdx + j, m)}</div>)}</CollapsibleToolGroup>)
              })() : renderMessage(item.idx, item.msg)}</div>
              })}
              
            </TranscriptScrollShell>
            </>
            )}
            {/* Restore cover. A session left mid-history reopens on a transcript
                that hydrates in chunks and is only positioned once its anchored
                row lands, so the rows underneath are briefly partial and in the
                wrong place. Showing them means the reader watches the transcript
                assemble and then jump; covering that window turns it into one
                deliberate load. A session left AT the live end never raises this
                -- it is placed on the first commit, with nothing to wait for. */}
            {/* ONE placeholder for both waits. Fetching the slot used to show a
                centred spinner and restoring a reading position used to show
                bars, so two readings of the same fact -- the transcript is not
                ready -- looked like different events. A spinner also says only
                "wait", where a skeleton previews the shape that is coming. */}
            {(slotLoading || virt.restoreGate) && <ChatTranscriptSkeleton />}
            {/* Composer dock. Floats over the bottom of the transcript scroller
                instead of sitting under it in the flex column, so the scroller
                runs the full height of the pane and the conversation scrolls
                UNDER the glass (iOS toolbar layout). The scroller pays for the
                covered strip with `paddingBottom: dockH + DOCK_CLEARANCE_PX`,
                measured from this box by `dockRef`. No z-index here on purpose:
                a positioned box with `z-index: auto` forms no stacking context,
                so SubagentProgressBar's wave chip keeps its `z-[46]` against
                the theme-experience overlays it was lifted to clear, and the
                dock still paints over the scroller because it follows it in
                DOM order. `pointer-events-none` on the root, restored on the
                CHILDREN of the two wrapper boxes (`dock-inert`, index.css) —
                each child is its own 900px column, so the two wrappers, which
                span the pane, never catch a wheel of their own — then the empty
                width either side of the column lets wheel and touch reach the
                transcript underneath, as the strip beside an iOS toolbar does.
                `right: dockGutter` keeps the scrollbar column clear (above). */}
            <div ref={dockRef} className="absolute left-0 bottom-0 pointer-events-none" style={{ right: dockGutter }} data-testid="composer-dock-root" {...{ [SELECTION_INERT_ATTR]: '' }}>
              <JumpToBottomButton visible={!isAtBottom && messages.length > 0} onClick={() => scrollBottom(true)} />
              {/* Status chrome never claims more than half the pane. The dock
                  is anchored to the pane's bottom edge and grows upward, so an
                  opening keyboard — which shrinks the layout viewport — would
                  let an uncapped stack rise into the title band at the top of
                  the pane and cover the rename editor. Capping makes the stack
                  yield first.
                  `svh` not `%` (a percentage resolves against this wrapper's own
                  content-derived height, so it computes to none) and not `vh`
                  (which over-measures a phone showing its URL bar). Scoped to
                  the bars: FlyingQuote, the composer and the `absolute -top-10`
                  scroll-to-bottom button must all stay outside the scroll box.
                  `pb-[11px] mb-[-11px]` cancels QueueStack's OVERLAP: its -11px
                  fuse margin is what pulls the queue card into the composer, and
                  a scroll container turns that overhang into permanent internal
                  overflow (measured: scrollHeight-clientHeight == 11 with a
                  collapsed queue at any height, so a thumb showed and the card's
                  bottom 11px clipped). The padding lands the child's margin edge
                  exactly on the padding box, and the equal negative margin keeps
                  the wrapper's contribution to the column unchanged, so the seam
                  still fuses. Layout-neutral when the queue is empty: the pair
                  cancels. `scrollbar-overlay` is what every other internal
                  scroller here uses (SkillDirectoryBrowser pairs it with the same
                  `overflow-y-auto overscroll-contain`): it replaces the global
                  always-visible `var(--border)` thumb with a hover-revealed
                  overlay one, so the capped box does not carry a permanent bar. */}
              <div ref={composerBandRef} className="max-h-[50svh] overflow-y-auto overscroll-contain scrollbar-overlay pb-[11px] mb-[-11px] dock-inert" data-testid="composer-status-stack">
              {/* Not gated on activityOpen (unlike the two bars below): the
                  activity sidebar has no TODO view, so hiding it there would
                  lose the information rather than de-duplicate it. */}
              <TaskProgressBar slot={activeSlot} />
              {/* De-duplicate ONLY against the matching sidebar tab (#728): each
                  bar is redundant when the activity sidebar is actually SHOWING
                  its own view (Subagents / Workflows), but on any OTHER tab
                  (Files, Changes, Logs, Artifacts) hiding it would lose the live
                  roster entirely. The condition mirrors the SidePanel's own
                  render guard (`activityOpen && !search.isOpen`) — so opening the
                  find pane, which UNMOUNTS the panel, re-shows the bar — and
                  reads the live panel tab (`tabsCtl`), NOT the Redux
                  `activityTab`, which only tracks programmatic openActivityToTab
                  calls and goes stale when the user clicks a tab in the panel. */}
              {!(activityOpen && !search.isOpen && tabsCtl.tabs.find(t => t.id === tabsCtl.activeId)?.kind === 'subagents') && <SubagentProgressBar slot={activeSlot} />}
              {!(activityOpen && !search.isOpen && tabsCtl.tabs.find(t => t.id === tabsCtl.activeId)?.kind === 'workflows') && <WorkflowProgressBar slot={activeSlot} />}
              <SubagentDeliveryProgress count={systemDeliveryCount} />
              <QueueStack messages={queuedMessages} onCancel={handleCancelQueued} onInterrupt={handleInterruptQueued} onEdit={handleEditQueued} onReorder={handleReorderQueued} pendingIds={queuePendingIds} fuseBelow={followUpOptions.length === 0 && !knowledgeFetch.pendingKnowledge} />
              </div>
              {flyingQuote && <FlyingQuote text={flyingQuote.text} from={flyingQuote.from} targetRef={inputAreaRef} onComplete={endQuoteFlight} />}
              <div ref={inputAreaRef} className="relative z-10 dock-inert">
              {/* The refused-press answer sits directly above the composer,
                  adjacent to the message-footer controls that raised it, so the
                  press cannot fail silently. Shares the chat column's own
                  container recipe (the page gutter + the theme content width)
                  rather than capping itself: a narrower centred box reads as
                  belonging to neither the transcript above nor the input below.

                  The title names the refused action. Without it the notice
                  reads as a generic error rather than "this is the answer to
                  the button you just pressed" — a first-time reader then
                  concludes the click did nothing and presses again. */}
              {refusedPress && (
                <div
                  className="px-4 mb-1.5 mx-auto w-full"
                  style={{ maxWidth: 'var(--mc-content-width, 900px)' }}
                  data-testid="refused-press-error"
                >
                  <ErrorNotice
                    title={i18nT(REFUSED_PRESS_TITLE_KEYS[refusedPress.action])}
                    message={refusedPress.message}
                    onDismiss={() => setRefusedPress(null)}
                    // Hand-off on. The composer beneath holds a live draft, but it
                    // is persisted per slot on every keystroke and on slot switch
                    // (the setDraft effects above), and an in-chat hand-off opens
                    // a FRESH slot without navigating away — so the draft survives.
                    askAgent
                  />
                </div>
              )}
              {showHistorySuggestions && (
                <div className="absolute left-0 right-0 bottom-full mb-1 mx-auto w-full max-w-[760px] border border-border rounded-lg bg-card overflow-hidden animate-scale-in z-50 shadow-lg flex flex-col max-h-[min(300px,40vh)]">
                  <div className="px-3.5 py-2.5 border-b border-border shrink-0">
                    <span className="text-[12px] font-semibold text-muted tracking-[.02em]">{i18nT('pages.chatPage.continue_a_previous_chat')}</span>
                  </div>
                  <div className="overflow-y-auto flex-1 min-h-0" role="listbox" aria-label={i18nT('pages.chatPage.previous_chats')}>
                    {historySuggestions.map((s) => (
                      <div
                        key={s.key}
                        role="option"
                        tabIndex={0}
                        aria-selected={false}
                        className="w-full text-left px-3.5 py-2.5 flex items-center gap-3 cursor-pointer transition-all border-b border-border last:border-0 hover:bg-bg-hover"
                        onMouseDown={(e) => { e.preventDefault(); handleResumeSession(s.key, s.title || s.key) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleResumeSession(s.key, s.title || s.key) }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[13px] text-text truncate">{s.title || s.key}</div>
                          {s.created && <div className="text-[11px] text-muted font-mono mt-0.5">{fmtDateFields(s.created, { year: 'numeric', month: 'short', day: 'numeric' })}</div>}
                        </div>
                        <Undo2 size={14} className="text-accent shrink-0" />
                      </div>
                    ))}
                  </div>
                  <div className="px-3.5 py-2 border-t border-border flex justify-end shrink-0">
                    <span className="text-[11px] text-muted-strong">{i18nT('pages.chatPage.esc_to_dismiss')}</span>
                  </div>
                </div>
              )}
              {knowledgeFetch.results.length > 0 || knowledgeFetch.loading || knowledgeFetch.error ? (
                <KnowledgePicker
                  results={knowledgeFetch.results}
                  query={knowledgeFetch.query}
                  loading={knowledgeFetch.loading}
                  error={knowledgeFetch.error}
                  onRetry={knowledgeFetch.retrySearch}
                  onInject={(selected) => {
                    knowledgeFetch.inject(selected)
                  }}
                  onSkip={() => knowledgeFetch.clearResults()}
                />
              ) : null}
              {(pendingQuestion || restoredQuestionNotice) && (
                <div className="px-4 pb-2 mx-auto w-full" style={{ maxWidth: 'var(--mc-content-width, 900px)' }}>
                  <PendingQuestionCard
                    slotKey={activeSlot}
                    onFallbackSend={keepQuestionAnswer}
                    onDirectSend={answerQuestionCard}
                  />
                </div>
              )}
              {pendingFollowup && activeSlot && (
                <div className="px-4 pb-2 mx-auto w-full" style={{ maxWidth: 'var(--mc-content-width, 900px)' }}>
                  <FollowUpCard
                    items={pendingFollowup.items}
                    projectDir={currentSlot?.project || undefined}
                    projectIsRepo={projectGitError ? undefined : projectGit?.repo}
                    onAddToSession={followupAddToSession}
                    onStartInWorktree={followupStartInWorktree}
                    onStartInNewChat={followupStartInNewChat}
                    onSkip={(index) => dispatch(dismissFollowupItem({ slot: activeSlot, index, ts: pendingFollowup.ts }))}
                  />
                </div>
              )}
              {showComposerMemoryChip && (
                // No backdrop: the chip is glass and whatever scrolls under it is meant to show.
                // `w-fit`, not a full-width flex row: the box is a `dock-inert` child, so
                // it catches input, and it should be no wider than the chip it holds.
                <div className="relative z-10 mx-auto w-fit px-4 pt-2 pb-2" data-testid="composer-memory-chip">
                  <MemoryModeChip memoryMode={currentSlot?.memory_mode ?? 'persistent'} onSwitchMode={switchMemoryMode} switching={memorySwitching} disabled={composerOptimizing} />
                </div>
              )}
              {/* Announces why the composer is locked; in every session, as the user may move on mid-switch. */}
              <span role="status" className="sr-only" data-testid="memory-switch-status">{memorySwitching ? i18nT('components.welcomeView.switching_memory_mode') : ''}</span>
              <Composer
                ref={composerRef}
                slotKey={activeSlot}
                draft={composerDraft}
                onChange={composerRootChange}
                voice={composerVoiceOptions}
                pastes={pasteSlice}
              >
              <StableChatInput
              aboveComposer={composerAbove}
              // No `value`: ChatInput reads the text from the root's `draft` store.
              // `composerUserEdit` is what ChatInput calls for the user's own edits
              // (typing, paste, undo, picker inserts), never for a parent-driven
              // seed -- so it is the signal that arms the prefill hint's expiry.
              onChange={composerUserEdit}
              onSend={() => send()}
              terminalCommands={activeSlot && !currentSlot ? 'pending' : currentSlot?.executor === 'remote' ? 'remote' : 'local'}
              canSteer={composerBusy}
              onSteer={steer}
              // AND a turn actually running. `composerBusy` is also true when only
              // background sub-agents are working, and there is no turn to decide
              // ABOUT in that state: the send starts a fresh turn and the point
              // never runs, so offering the mode there would promise a decision
              // nothing makes.
              jevAutoAvailable={jevAutoConsented && !!slotRunning}
              onFollowUpSend={(text?: string) => send(text)}
              // Streaming, compaction and stopping keep the input interactive (api_chat queues on slot.running and stop preserves the
              // queue, so Enter queues a follow-up during the stop window). Only a memory-mode switch locks it, the reason as placeholder.
              disabled={memorySwitching} lockedPlaceholder={memorySwitching ? i18nT('components.welcomeView.switching_memory_mode') : undefined}
              autoFocusKey={activeSlot}
              prefillHint={prefillHint}
              onDismissHint={() => setPrefillHint(false)}
              onScreenshot={handleCapture}
              onUploadFiles={composerUploadFiles}
              /* Only while the active slot has a live upload request, whichever
                 host started it. `uploading` is shared with the screenshot
                 path, which has no request to cancel. */
              onCancelUpload={uploadCancellable ? cancelUpload : undefined}
              /* The one collapsible composer. Opt-in rather than default so the
                 shared preference key and the window-level expand event stay
                 correct by construction -- see ChatInput's `collapsible` prop. */
              collapsible
              /* `uploading` clears when the FIRST of several producers settles; the counted hold keeps the spinner and cancel control up until the last one does. */
              uploading={uploading || sendHeld}
              holdSend={sendHeld}
              pendingFiles={pendingFiles}
              pendingDirs={pendingDirs}
              resizedInfo={resizedInfo}
              onRemoveFile={removeFileChip}
              onRemoveDir={removeDirChip}
              attachmentAnnouncement={attachmentAnnouncement}
              pendingSessions={pendingSessions}
              pendingQuote={messageQuote.pendingQuote}
              onRemoveQuote={messageQuote.clearQuote}
              onRemoveSessionRef={unstageSessionRef}
              onFileSelect={selectPickedFile}
              onFileOpen={handleFileOpen}
              // A tree row dropped on the composer is "Add to chat" by drag.
              onTreeEntryDrop={handleAddToContext}
              clampDropOffset={clampOutOfTokens}
              onMentionKey={mentionKeyEdit}
              optimizerMentionGuard={optimizerMentionGuard}
              project={currentSlot?.project || ''}
              projectBranch={projectBranch}
              projectDetached={!projectGitError && !!projectGit?.detached}
              isMac={isMac}
              onDrop={dropTargetProps.onDrop}
              onDragOver={dropTargetProps.onDragOver}
              onDragLeave={dropTargetProps.onDragLeave}
              agentName={activeAgentName}
              // The chip shows the inherited-default marker; `agentName` stays
              // the raw resolved alias for the skills query and switch title.
              // Uses the SLOT's stored agent (not `activeAgentName`, which has
              // already collapsed empty->default) so an agent-less slot reads
              // `<default> · default` and a pinned one reads the bare alias (#8770).
              agentLabel={agentOrDefaultLabel(currentSlot?.agent, defaultAgent)}
              agentIsInheritedDefault={!currentSlot?.agent && !!defaultAgent}
              agentSource={effectiveAgents.find(a => a.name === activeAgentName)?.source}
              modelName={shownModel}
              modelIsInheritedDefault={modelMarker === 'default'}
              modelIsAutoChosen={modelMarker === 'auto'}
              // The turn's model is Jev's to pick exactly when the routing gate
              // says so: the slot names no model, and the preview is on. Reads the
              // slot's RAW model, not `shownModel` -- that one substitutes the
              // served id for an inheriting slot, so it is almost never `auto` and
              // would hide every routed turn. Same `jevRouteOn` the picker's row is
              // drawn from, so chip, menu and gate cannot disagree.
              modelIsJevRouted={jevRouteOn && isUnpinnedModel(currentSlot?.model)}
              onAgentClick={provider.capabilities.agentTemplates ? (rect, trigger) => { anchorAgentBtn(rect, trigger); setAgentDropdown(!agentDropdown) } : undefined}
              onModelClick={(rect, trigger, composerHadFocus) => {
                modelPickerReturnsFocusRef.current = !!composerHadFocus
                anchorModelBtn(rect, trigger); setModelDropdown(!modelDropdown)
              }}
              onProjectClick={(rect, trigger) => {
                anchorProjectBtn(rect, trigger)
                setProjectPickerOpen(o => !o)
              }}
              sessionControls={composerSessionControls}
              onSessionControlClick={(key, rect, trigger) => {
                anchorSessionControl(rect, trigger)
                // Two independent setState calls, not one updater with a side
                // effect: React may run an updater twice (StrictMode does in
                // dev), which would bump the refresh token twice per toggle and
                // fire a redundant status poll.
                if (openSessionControl?.key === key) {
                  setOpenSessionControl(null)
                  refreshSessionControlStatuses()
                } else {
                  // Capture the slot the control is opened in: the host render
                  // is gated on it still matching activeSlot, so a chat switch
                  // can never mount the control against the next session.
                  setOpenSessionControl({ key, slot: activeSlot })
                }
              }}
              contextPct={contextPct}
              contextUsedTokens={contextTokens?.used}
              contextWindowTokens={contextTokens?.window || provider.getContextWindow(shownModel)}
              showContextPct={chatConfig.showContextPct}
              showContextTokens={chatConfig.showContextTokens}
              isRunning={composerBusy}
              projectLocked={projectLocked}
              /* Composed with `interrupted`, matching the ErrorCard gate above.
                 Availability alone would put a filled primary button on the
                 composer of every idle chat that holds a conversation — an
                 accent-filled control reads as "this is your next move", so on
                 a slot that finished cleanly it advertises pending work that
                 does not exist and the only thing distinguishing it from Send
                 is a hover tooltip. `interrupted` is not merely the wording
                 now: it is the reason the control exists at all. When nothing
                 proves an interruption the composer falls back to the ordinary
                 Send button, disabled while empty, like every other chat.

                 The cost is a turn that died leaving no evidence — a hard kill
                 after a mid-turn assistant segment already flushed, which is
                 the one shape `_is_interrupted` cannot see. That slot loses its
                 one-click nudge; typing anything still resumes it. Closing that
                 hole needs a persisted turn-in-flight marker (backend), not a
                 louder button here.

                 `cardOwnsRecovery` is the case where the card and the composer
                 would otherwise disagree (#13342): the newest row is one whose
                 card has withheld Resume because a retry replays the
                 rejection, and offers a remedy of its own instead -- the issue
                 form for a refused feature request, the restart hint for a
                 session start that failed twice, a fresh session for a
                 conversation too big for the model, or a refused app-owned
                 agent turn. A composer beneath it saying "press Resume" would
                 argue with the card, so it falls back to the ordinary Send
                 button; typing still works. */
              continuable={continuable && interrupted && !cardOwnsRecovery}
              continueIsRecovery={interrupted}
              onContinue={handleContinue}
              continuing={continuing}
              onStop={stopTurn}
              isQueued={slotStopping}
              stopState={currentSlot?.stop_state}
              compacting={!!currentSlot?.compacting}
              stopDeclined={!!currentSlot?.stop_declined}
              approvalMode={displayMode}
              providerId={provider.id}
              reasoningEffort={effectiveEffort}
              effortIsDefault={!currentSlot?.reasoning_effort && !legacyCodexEffort(currentSlot?.model || '', '', codexPairModels) && !!defaultEffort}
              // Effort is edited INSIDE the model picker (one control, see
              // docs/decisions/2026-06-14-chat-composer-model-and-effort-are-one-control.md);
              // the chip only names the level in force.
              hasEffort={effortSupported}
              onAutomationClick={setAutomationOpen}
              automation={automation}
              automationOpen={automationOpen}
              automationCreationReady={automationCreationReady}
              automationSnapshotFailed={automationSnapshotFailed}
              sessionMode={currentSlot?.mode || mode}
              onAutomationChange={applyAutomationChange}
              onOptimizeResult={handleOptimizeResult}
              onOptimizingChange={handleOptimizingChange}
              memoryMode={currentSlot?.memory_mode ?? 'persistent'}
              sentMessages={sentMessages}
              onEditLastRequest={handleEditLastRequest}
              sendOnEnter={isMobile && isTouch ? 'ctrl-enter' : chatConfig.sendOnEnter}
              followUpOptions={followUpOptions}
              followUpPicked={followUpPicked}
              quickSend={dashCfg?.quick_send}
              followUpLayout={chatConfig.followUpLayout}
              followUpSourceKey={followUpSourceKey}
              followUpMulti={followUpMulti}
              onFollowUpSelect={(o: string, e: React.MouseEvent, _key: string | null | undefined, sendNow: (text: string) => void) => {
                // One-click: enabled + no shift + not busy + not already in multi-select.
                // `sendNow` is the composer's chip send: it steers or queues per the slot's busy-send mode.
                if (tryQuickSend(o, dashCfg?.quick_send, e.shiftKey, slotRunning, followUpPickedRef.current.size, sendNow)) return
                toggleFollowUpOption(o)
              }}
              showFullPastes={chatConfig.showFullPastes}
              knowledgeChip={knowledgeFetch.pendingKnowledge ? <div className="flex items-start gap-1"><KnowledgeBubbleChip knowledge={{ items: knowledgeFetch.pendingKnowledge.items.length, tokens: knowledgeFetch.pendingKnowledge.totalTokens, titles: knowledgeFetch.pendingKnowledge.items.map(i => i.title), content: knowledgeFetch.pendingKnowledge.items.map(i => ({ title: i.title, text: i.content.slice(0, 2000) })) }} /><button type="button" onClick={() => knowledgeFetch.clearPending()} className="shrink-0 mt-0.5 p-0.5 text-muted hover:text-danger-text bg-transparent border-none cursor-pointer rounded hover:bg-danger/10 transition-colors" aria-label={i18nT('pages.chatPage.remove_knowledge_context')} title={i18nT('pages.chatPage.remove_knowledge_context')}>&times;</button></div> : undefined}
              connected={connected}
            />
              </Composer>
            </div>
            {/* Agent dropdown portal — triggered from input bar */}
            {agentDropdown && agentBtnRect && createPortal(
              // The keydown handler routes arrow/Enter navigation to the inner
              // role="listbox"; the dialog is a focus container (tabIndex={-1}),
              // not an interactive widget itself, so this delegation is intentional.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <div ref={agentDropdownRef} role="dialog" aria-label={i18nT('pages.chatPage.agent_selector')} tabIndex={-1} onKeyDown={onAgentListKeyDown} className="fixed z-[9999] bg-bg-elevated border border-border rounded-xl shadow-xl min-w-[260px] max-w-[340px] flex flex-col p-1 gap-0.5 animate-slide-up" style={(() => { const left = Math.max(8, Math.min(agentBtnRect.left, window.innerWidth - 348)); return { bottom: window.innerHeight - agentBtnRect.top + 4, left } })()}>
                <div className="px-1.5 pt-1.5 pb-1">
                  <Input ref={agentInputRef} type="text" aria-label={i18nT('pages.chatPage.filter_agents')} placeholder={i18nT('pages.chatPage.type_to_filter')} value={agentFilter} onChange={e => setAgentFilter(e.target.value)} className="w-full px-2 py-1 text-[13px]" />
                </div>
                <div role="listbox" aria-label={i18nT('pages.chatPage.agent_list')} className="overflow-y-auto max-h-[280px]">
                <AgentDropdownList agents={filteredAgents} activeAgent={activeAgentName} activeKind={currentSlot?.agent_kind} defaultAgent={defaultAgent} onSelect={(name, kind) => { switchAgent(name, kind); setAgentDropdown(false) }} filter={agentFilter} />
                </div>
                {/* Embedded chat gets neither half of the default-agent affordance: it has
                    no /capabilities route for the footer, and the footer is what carries the
                    failed-write alert — offering the write without its error path would make
                    a rejected request indistinguishable from a successful one. */}
                {/* The default for new sessions is a template; a crewmate's chat offers no such write. */}
                {!embedded && !isCrewmateChat(currentSlot?.agent_kind, activeAgentName, installedAgents) && <DefaultAgentRow agentName={activeAgentName} isDefault={activeAgentName === defaultAgent} onSetDefault={() => toggleDefaultAgent(activeAgentName, defaultWriteKind(currentSlot?.agent_kind))} />}
                {!embedded && <ManageAgentsFooter error={defaultAgentFailed} onManage={() => { setAgentDropdown(false); navigate('/capabilities?tab=crews') }} />}
              </div>,
              document.body
            )}
            {/* Model dropdown portal — triggered from input bar */}
            {modelDropdown && modelBtnRect && createPortal(
              <ModelEffortDropdown
                anchorRect={modelBtnRect}
                dropdownRef={modelDropdownRef}
                inputRef={modelInputRef}
                onListKeyDown={onModelListKeyDown}
                models={filteredModels}
                activeModel={jevRouteShownModel(shownModel, currentSlot)}
                onSelectModel={pickModel}
                filter={modelFilter}
                setFilter={setModelFilter}
                onClose={() => setModelDropdown(false)}
                modelVisibilityError={hiddenModelsQ.isError}
                onRetryModelVisibility={() => hiddenModelsQ.refetch()}
                // The embedded effort slider is fed by the slot's ACP
                // capability read (#13637): the agent's own answer wins over
                // the static model-name heuristic, and its level list replaces
                // this machine's when it reports one.
                hasEffort={!!(activeSlot && effortSupported)}
                slot={activeSlot}
                currentEffort={currentSlot?.reasoning_effort || legacyCodexEffort(currentSlot?.model || '', '', codexPairModels)}
                defaultEffort={defaultEffort}
                effortLevelsOverride={effortLevelsOverride}
                onManageModels={modelPickerConfigured ? undefined : () => {
                  setModelDropdown(false)
                  navigate(settingsPath({ tab: 'chat', sub: 'models', highlight: 'key:dashboard.model_picker_hidden_models' }))
                }}
                onSetDefault={() => {
                  setModelDropdown(false)
                  navigate(settingsPath({ tab: 'chat', sub: 'models', highlight: SETTINGS_DEFAULT_MODEL_ID }))
                }}
                agentName={_modelPinAgent}
                pinModelName={_modelPinActive || 'auto'}
                pinModelUnavailable={pinIsWithheld(_modelPinActive, _pinShownModel)}
                pinnedToAgent={_modelPinPinned}
                onPinToAgent={() => {
                  setModelDropdown(false)
                  pinModelToAgentMut.mutate({
                    agent: _modelPinAgent,
                    // The slot's REAL model, never the display fallback: a
                    // stale/degraded list must not be able to persist 'auto'
                    // over a pin the account actually has.
                    model: _modelPinActive === 'auto' ? '' : _modelPinActive,
                  })
                }}
              />,
              document.body
            )}
            {/* Project picker — triggered from input bar */}
            <ProjectPicker
              open={projectPickerOpen}
              onOpenChange={setProjectPickerOpen}
              anchorRect={projectBtnRect}
              onSelect={path => { setProject(path); setProjectPickerOpen(false) }}
              startPath={_slotProject}
              errorHandoff
              footer={_slotProject
                ? <ProjectAwsProfileSection project={_slotProject} errorHandoff onHandoff={() => setProjectPickerOpen(false)} />
                : undefined}
            />
            {/* App-contributed session control popover — triggered from input bar.
                Only the open one is mounted, so an app's control costs nothing
                while closed. Render is gated on the slot the control was opened
                in: on a chat switch the committed render where activeSlot has
                already moved would otherwise mount a fresh control (the host
                keys on session) bound to the NEW chat, and a control that
                writes per-session state on mount would write to the wrong
                chat. The clearing effect above runs too late to prevent that
                render — this gate is the correctness guard. */}
            {(() => {
              const sc =
                openSessionControl && openSessionControl.slot === activeSlot
                  ? sessionControls.find(c => c.key === openSessionControl.key)
                  : null
              if (!sc) return null
              return (
                <SessionControlHost
                  /* Keyed on the control, and load-bearing: the host's error
                     boundary holds `state.error`, and nothing clears it on a
                     prop change. Unkeyed, React reuses the one instance across
                     controls, so opening B after A crashed would show B the
                     stale error and never mount it. The key makes switching
                     controls a remount, which is the only thing that resets the
                     boundary. Do not remove it. */
                  key={sc.key}
                  control={sc}
                  anchorRect={sessionControlRect}
                  onClose={() => {
                    setOpenSessionControl(null)
                    refreshSessionControlStatuses()
                  }}
                  session={{
                    sessionKey: sessionControlKey,
                    folderId: currentSlot?.folder_id || '',
                    folderName: activeFolderName,
                    cwd: currentSlot?.project || '',
                  }}
                />
              )
            })()}
            </div>
          </div>
          </SearchHighlightContext.Provider>
        )}
      </div>
      )}
      {search.isOpen && (
          <DetailPanel
            key="search-panel"
            title={<SearchBar docked term={search.term} setTerm={search.setTerm} matches={search.matches} currentIdx={search.currentIdx} next={search.next} prev={search.prev} close={search.close} caseSensitive={search.caseSensitive} toggleCaseSensitive={search.toggleCaseSensitive} focusNonce={search.focusNonce} goTo={search.goTo} scopeLimited={searchScopeIsLimited({ slotHasMore, cursorIsForActiveSlot })} />}
            onClose={search.close}
            initialWidth={400}
            minWidth={320}
            reserveWidth={panelReserve}
            storageKey="mc-search-width"
            noPadding
          >
            {search.matches.length > 0 ? (
              <SearchResultsList
                matches={search.matches}
                currentIdx={search.currentIdx}
                messages={messages}
                term={search.term}
                caseSensitive={search.caseSensitive}
                onJump={jumpToSearchResult}
              />
            ) : (
              <div className="px-4 py-3 text-[13px] text-muted">{search.term ? i18nT('pages.chatPage.no_results') : i18nT('pages.chatPage.type_to_search_this_conversation')}</div>
            )}
          </DetailPanel>
        )}
      <AnimatePresence initial={false}>
        {/* Inline side panel — mobile / embed frames where there's no actbar
            grid column. Desktop uses the actbar portal below.

            MOBILE is a fixed overlay sliding in from the RIGHT on the
            compositor (sideOverlayX / animateDrawer), mirroring the sessions
            drawer: the old `width: 0 → auto` reveal is a LAYOUT animation, so
            it re-laid-out the panel AND the squeezed chat pane every frame.
            Mount is held through 'closing' so the slide-out is not cut short.
            Embed frames keep the width reveal — they have no overlay chrome. */}
        {(isMobile
          // `hasLiveAppTab` keeps a closed-but-alive panel MOUNTED (display:none
          // below) so its iframe — and the drawing inside it — survives the
          // close, exactly as the width-reveal branch always did.
          ? (sideOverlayPhase !== 'closed'
              || (shouldMountSidePanel({ activityOpen, hasLiveAppTab, hasBrowserTab, hasTaskDashboard, searchOpen: search.isOpen })
                  && isSidePanelHidden({ activityOpen, hasLiveAppTab, hasBrowserTab, hasTaskDashboard, searchOpen: search.isOpen }))) && !activitySlot
          : shouldMountSidePanel({ activityOpen, hasLiveAppTab, hasBrowserTab, hasTaskDashboard, searchOpen: search.isOpen }) && !activitySlot) && (
          <motion.div
            key="side-panel-inline"
            ref={isMobile ? sideOverlayPanelRef : undefined}
            initial={isMobile ? false : { width: 0 }}
            animate={isMobile ? undefined : { width: 'auto' }}
            exit={isMobile ? undefined : { width: 0 }}
            transition={isMobile ? undefined : { duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            // Below the 42px app topbar, like the sessions drawer — the panel
            // takes over the CONTENT area, not the shell chrome.
            className={isMobile
              ? 'fixed top-safe-offset-[42px] bottom-safe left-safe right-safe z-[47] flex justify-end bg-bg'
              : 'h-full overflow-hidden flex justify-end shrink-0'}
            // Kept mounted for a live app tab: hide instead of unmounting so the
            // iframe (and the drawing inside it) survives a panel close. On
            // mobile the overlay phase already owns mount/hide timing, and the
            // offset is BOUND (not a one-shot read): a drag writes the value
            // directly, so only a live binding paints those frames — the
            // compositor settle still runs through the registered element above.
            style={isMobile
              ? (sideOverlayPhase === 'closed'
                  ? { display: 'none' } // keep-alive: mounted for the iframe, invisible
                  : { x: sideOverlayX })
              : (isSidePanelHidden({ activityOpen, hasLiveAppTab, hasBrowserTab, hasTaskDashboard, searchOpen: search.isOpen }) ? { display: 'none' } : undefined)}
          >
            <SidePanel
              tabsCtl={tabsCtl}
              slot={activeSlot || ''}
              panelHidden={isSidePanelHidden({ activityOpen, hasLiveAppTab, hasBrowserTab, hasTaskDashboard, searchOpen: search.isOpen })}
              onFileOpen={handleFileOpen}
              onArtifactOpen={handleArtifactOpen}
              onAddToContext={handleAddToContext} onComposerInsert={insertDashboardReply}
              onOpenWorkingTreeDiff={handleOpenWorkingTreeDiff}
              projectDir={currentSlot?.project || undefined} navLinks={chatNav.links} navResolving={chatNav.resolving}
              sources={panelSources} selectedSourceUrl={selectedSourceUrl} onSelectSource={selectSourceUrl} onReconcileSource={reconcileSourceUrl}
              issues={panelIssues} selectedIssueUrl={selectedIssueUrl} onSelectIssue={selectIssueUrl} onReconcileIssue={reconcileIssueUrl}
              onAddSourceToChat={addSourceCommentToChat}
              onSubmitComments={submitComments} connected={connected} onFileSave={handleFileSave} onClose={toggleAct}
              pins={chatPins} pinsLoading={chatPinsLoading} onJumpToPin={handleJumpToPin} onUnpin={handleUnpinById}
              slotTitle={activeSlotTitle} chatMode={mode}
              expanded={panelMaximized}
              fillWidth={panelFillWidth}
              extraReserveW={!isMobile && sidebarOpen ? effectiveSidebarWidth : 0}
              canDockBottom={false}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* Full-height tabbed side panel: portaled into the App shell's
          'actbar' grid column so it spans the window top-to-bottom; the header
          row ends at its left edge, shifting the top-bar buttons left.
          The motion wrapper animates the column width 0 -> auto: the actbar
          grid column tracks it frame-by-frame, so the chat pane slides left in
          sync while the panel (right-anchored via justify-end) slides out from
          the window edge — both sides move together instead of snapping. */}
      {activitySlot && createPortal(
        <AnimatePresence initial={false}>
          {shouldMountSidePanel({ activityOpen, hasLiveAppTab, hasBrowserTab, hasTaskDashboard, searchOpen: search.isOpen }) && (
            <motion.div
              key="side-panel"
              initial={sidePanelDockAnim.initial}
              animate={sidePanelDockAnim.animate}
              exit={sidePanelDockAnim.exit}
              transition={SIDE_PANEL_DOCK_TRANSITION}
              className={sidePanelDock === 'bottom' ? 'w-full overflow-visible flex flex-col justify-end' : 'h-full overflow-visible flex justify-end'}
              style={isSidePanelHidden({ activityOpen, hasLiveAppTab, hasBrowserTab, hasTaskDashboard, searchOpen: search.isOpen }) ? { display: 'none' } : undefined}
            >
              <SidePanel
                tabsCtl={tabsCtl}
                slot={activeSlot || ''}
                panelHidden={isSidePanelHidden({ activityOpen, hasLiveAppTab, hasBrowserTab, hasTaskDashboard, searchOpen: search.isOpen })}
                onFileOpen={handleFileOpen}
                onArtifactOpen={handleArtifactOpen}
                onAddToContext={handleAddToContext} onComposerInsert={insertDashboardReply}
                onOpenWorkingTreeDiff={handleOpenWorkingTreeDiff}
                projectDir={currentSlot?.project || undefined} navLinks={chatNav.links} navResolving={chatNav.resolving}
                sources={panelSources} selectedSourceUrl={selectedSourceUrl} onSelectSource={selectSourceUrl} onReconcileSource={reconcileSourceUrl}
              issues={panelIssues} selectedIssueUrl={selectedIssueUrl} onSelectIssue={selectIssueUrl} onReconcileIssue={reconcileIssueUrl}
              onAddSourceToChat={addSourceCommentToChat}
                onSubmitComments={submitComments} connected={connected} onFileSave={handleFileSave} onClose={toggleAct}
                pins={chatPins} pinsLoading={chatPinsLoading} onJumpToPin={handleJumpToPin} onUnpin={handleUnpinById}
                slotTitle={activeSlotTitle} chatMode={mode}
                expanded={panelMaximized}
                fillWidth={panelFillWidth}
                extraReserveW={!isMobile && sidebarOpen ? effectiveSidebarWidth : 0}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        activitySlot
      )}
    </div>
    </ClosedSessionCtx.Provider>
    </SidebarFolderCtx.Provider>
    </JiraHostsCtx.Provider>
    </TagPopoverProvider>
    </SidePanelDockHost>
    </RowDisclosureProvider>
    </RunInTerminalScope.Provider>
  )
}
