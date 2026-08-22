import type { ReactNode } from 'react'
import LivePanel from '../screens/live/LivePanel'
import MockCallFrame from '../screens/live/MockCallFrame'
import FindOverlay from '../screens/find/FindOverlay'
import Strip from '../screens/strip/Strip'
import BankScreen from '../screens/bank/BankScreen'
import EditorPane from '../screens/bank/EditorPane'
import ImportPane from '../screens/bank/ImportPane'
import SetupScreen from '../screens/setup/SetupScreen'
import ArmedCard from '../screens/setup/ArmedCard'
import RecapScreen from '../screens/recap/RecapScreen'
import { WHISPER_TIERS } from '@shared/models'
import './gallery.css'

// Static state gallery (?screen=…): every screen at its reference frame with
// the design mock's exact copy, for design verification and review. Not part
// of the app's runtime flow — screens receive inert fixture props.

const noop = (): void => {}

function Frame({
  width,
  height,
  children,
  bare = false
}: {
  width: number
  height: number
  children: ReactNode
  bare?: boolean
}): JSX.Element {
  return (
    <div className="gallery">
      <div className={bare ? 'gallery-frame gallery-frame--bare' : 'gallery-frame'} style={{ width, height }}>
        {children}
      </div>
    </div>
  )
}

// ---- 2a: live panel docked beside the call ---------------------------------

function LiveMatched(): JSX.Element {
  return (
    <Frame width={1428} height={836}>
      <MockCallFrame
        headerLeft="Senior PM · Round 2 · 3 participants"
        timer="12:41"
        speakerPill="Priya R. · speaking"
      >
        <LivePanel
          mode="matched"
          matched={{
            question: 'Tell me about a time you disagreed with your manager.',
            covered: 2,
            total: 4,
            points: [
              {
                id: 'p1',
                text: 'Frame it as a data disagreement, not a personality one',
                state: 'covered'
              },
              { id: 'p2', text: 'I brought a two-week test instead of an argument', state: 'covered' },
              { id: 'p3', text: 'Say out loud that I was partly wrong', state: 'current' },
              { id: 'p4', text: 'Land on the relationship after, not the win', state: 'upcoming' }
            ],
            onTogglePoint: noop,
            story: {
              label: 'STORY TO TELL',
              body: 'Checkout redesign, Q3. Priya wanted the full rebuild; I pushed a stripped one-page test first. It shipped in nine days and cut drop-off 18%, and the rebuild used what we learned.',
              metrics: ['9 days', '−18% drop-off']
            },
            earlier: [
              // resumable, as they are in the running app — the gate has to
              // see the element that actually ships (a button, not a div)
              { key: 'g-1', question: 'Why this team?', time: '08:12', onResume: () => {} },
              {
                key: 'g-2',
                question: 'Walk me through the last thing you shipped',
                time: '04:50',
                onResume: () => {}
              }
            ]
          }}
          unsure={null}
          transcript={{
            speaker: 'you',
            text: '“…so I asked for two weeks and a stripped-down version before we committed to',
            highlight: 'stripped-down version',
            trailingWords: 1
          }}
          transcriptVisible
          onToggleTranscript={noop}
          onFind={noop}
          onCollapse={noop}
          onSearchBank={noop}
        />
      </MockCallFrame>
    </Frame>
  )
}

// ---- 1a second frame: unsure state -----------------------------------------

function LiveUnsure(): JSX.Element {
  return (
    <Frame width={404} height={760}>
      <LivePanel
        mode="unsure"
        matched={null}
        unsure={{
          heard: "…how do you decide what not to do when everything's on fire?",
          candidates: [
            {
              entryId: 'c1',
              title: 'How do you prioritize competing work?',
              sub: '4 points · Roadmap freeze story',
              pct: 81
            },
            {
              entryId: 'c2',
              title: 'Tell me about a time you dropped something.',
              sub: '3 points · Billing migration story',
              pct: 64
            },
            {
              entryId: 'c3',
              title: 'How do you work under pressure?',
              sub: '3 points · On-call week story',
              pct: 52
            }
          ],
          countdownSec: 4,
          countdownPct: 38,
          onPick: noop,
          onNone: noop,
          onSearchBank: noop
        }}
        transcript={{
          speaker: 'them',
          text: "…everything's on fire, right, so how do you decide what not to do —",
          highlight: 'how do you decide what not to do',
          trailingWords: 1
        }}
        transcriptVisible
        onToggleTranscript={noop}
        onFind={noop}
        onCollapse={noop}
        onSearchBank={noop}
      />
    </Frame>
  )
}

// ---- 2b: panic find --------------------------------------------------------

function Find(): JSX.Element {
  return (
    <Frame width={412} height={640}>
      <FindOverlay
        query="weakness"
        matchCount={3}
        results={[
          {
            entryId: 'f1',
            title: "What's your biggest weakness?",
            preview: [
              'I over-index on polish',
              'caught it on the billing launch',
              'now I timebox reviews'
            ],
            sub: null
          },
          {
            entryId: 'f2',
            title: 'A hard call you got wrong',
            preview: null,
            sub: '3 points · Notifications rollback'
          },
          {
            entryId: 'f3',
            title: "Feedback you've had that stung",
            preview: null,
            sub: "4 points · Priya's Q1 review"
          }
        ]}
        selectedIndex={0}
        onQueryChange={noop}
        onPinEntry={noop}
        onMove={noop}
        onPin={noop}
        onClose={noop}
      />
    </Frame>
  )
}

// ---- 2c: share-safe strip --------------------------------------------------

function StripOverShare(): JSX.Element {
  return (
    <Frame width={760} height={452} bare>
      <div className="gallery-share">
        <div className="gallery-share__label">YOUR SHARED SCREEN</div>
        <div className="gallery-share__strip">
          <Strip
            variant="current"
            text="Say I was partly wrong"
            counter="3/4"
            overlay
            protectionOn
            onExpand={noop}
          />
        </div>
      </div>
    </Frame>
  )
}

function StripQueued(): JSX.Element {
  return (
    <Frame width={366} height={39} bare>
      <Strip
        variant="queued"
        text="Land on the relationship, not the win"
        counter="4/4"
        overlay={false}
        protectionOn
        onExpand={noop}
      />
    </Frame>
  )
}

function StripNew(): JSX.Element {
  return (
    <Frame width={366} height={39} bare>
      <Strip
        variant="new-question"
        text="New: How do you prioritize?"
        counter={null}
        overlay={false}
        protectionOn
        onExpand={noop}
      />
    </Frame>
  )
}

// ---- 3a: question bank -----------------------------------------------------

function Bank(): JSX.Element {
  return (
    <Frame width={1280} height={812}>
      <BankScreen
        loops={[
          { id: 'l1', shortName: 'Senior PM · Northwind' },
          { id: 'l2', shortName: 'Group PM · Halcyon' },
          { id: 'l3', shortName: 'Practice / cold calls' }
        ]}
        selectedLoopId="l1"
        sections={[
          { id: 's1', name: 'Behavioural', count: 9 },
          { id: 's2', name: 'Product sense', count: 6 },
          { id: 's3', name: 'Execution', count: 5 },
          { id: 's4', name: 'Closing', count: 3 }
        ]}
        storiesCount={11}
        answerCount={23}
        groups={[
          {
            sectionId: 's1',
            sectionName: 'BEHAVIOURAL',
            rows: [
              {
                id: 'b1',
                question: 'Tell me about a time you disagreed with your manager',
                pointsLabel: '4 points',
                storyTitle: 'Checkout redesign'
              },
              {
                id: 'b2',
                question: 'A hard call you got wrong',
                pointsLabel: '3 points',
                storyTitle: 'Notifications rollback'
              },
              {
                id: 'b3',
                question: "What's your biggest weakness?",
                pointsLabel: '3 points',
                storyTitle: 'Billing launch'
              },
              {
                id: 'b4',
                question: "Feedback you've had that stung",
                pointsLabel: '4 points',
                storyTitle: "Priya's Q1 review"
              },
              {
                id: 'b5',
                question: 'Working with a difficult stakeholder',
                pointsLabel: '3 points',
                storyTitle: null,
                noStory: true
              }
            ]
          },
          {
            sectionId: 's2',
            sectionName: 'PRODUCT SENSE',
            rows: [
              {
                id: 'b6',
                question: 'How would you improve our onboarding?',
                pointsLabel: '5 points',
                storyTitle: 'framework'
              },
              {
                id: 'b7',
                question: 'Pick a product you love and critique it',
                pointsLabel: '4 points',
                storyTitle: null
              },
              {
                id: 'b8',
                question: 'How do you size a new market?',
                pointsLabel: '3 points',
                storyTitle: null
              }
            ]
          }
        ]}
        selectedAnswerId="b1"
        detail={{
          crumb: 'BEHAVIOURAL · ASKED IN 3 LOOPS',
          question: 'Tell me about a time you disagreed with your manager.',
          points: [
            { id: 'p1', text: 'Frame it as a data disagreement, not a personality one' },
            { id: 'p2', text: 'I brought a two-week test instead of an argument' },
            { id: 'p3', text: 'Say out loud that I was partly wrong' },
            { id: 'p4', text: 'Land on the relationship after, not the win' }
          ],
          story: {
            label: 'Checkout redesign, Q3',
            body: 'Priya wanted the full rebuild; I pushed a stripped one-page test first. It shipped in nine days and cut drop-off 18%, and the rebuild used what we learned.',
            metrics: ['9 days', '−18% drop-off', '3 eng, 1 design'],
            usedIn: 4
          },
          triggers: ['pushed back on leadership', 'conflict with your boss', 'disagree and commit'],
          lastUsed: 'Last used · Halcyon screen, 12 Aug',
          lastUsedRight: 'Covered 4/4 that time',
          onEdit: noop,
          onPractice: noop,
          onAddPhrase: noop,
          onRemovePhrase: noop
        }}
        editing={false}
        editorSlot={null}
        searchQuery=""
        onSearch={noop}
        onSelectLoop={noop}
        onSelectAnswer={noop}
        onNewAnswer={noop}
        onImport={noop}
        onStories={noop}
      />
    </Frame>
  )
}

// ---- 3b: entry editor ------------------------------------------------------

function Editor(): JSX.Element {
  return (
    <Frame width={520} height={812}>
      <EditorPane
        question="Tell me about a time you disagreed with your manager."
        points={[
          { id: 'p1', text: 'Frame it as a data disagreement, not a personality one' },
          { id: 'p2', text: 'I brought a two-week test instead of an argument' },
          { id: 'p3', text: 'Say out loud that I was partly wrong' },
          { id: 'p4', text: 'Land on the relationship after, not the win' }
        ]}
        story={{ title: 'Checkout redesign, Q3', sub: 'from stories library · 3 metrics attached' }}
        triggers={['pushed back on leadership', 'conflict with your boss']}
        onQuestionChange={noop}
        onPointChange={noop}
        onPointAdd={noop}
        onPointRemove={noop}
        onPointsReorder={noop}
        onTriggerAdd={noop}
        onTriggerRemove={noop}
        onSwapStory={noop}
        onDelete={noop}
        onCancel={noop}
        onSave={noop}
      />
    </Frame>
  )
}

/** import/export in pane 3, with a paste already previewed. Not part of the
 *  pinned comparison — the mock has no such surface — but the preview is the
 *  thing that stops an import mangling someone's prep, so it needs reviewing. */
function Importer(): JSX.Element {
  return (
    <Frame width={520} height={812}>
      <ImportPane
        text={'Tell me about a time you disagreed with your manager.\n- Frame it as a data disagreement\n- I brought a two-week test'}
        onTextChange={noop}
        preview={{
          summary: '12 questions · 47 points',
          warnings: [
            '3 have no points — they will show as a card with nothing to strike through.',
            '2 look like questions you already have.'
          ],
          sample: [
            { question: 'Tell me about a time you disagreed with your manager.', points: 4, duplicate: false },
            { question: 'Why this team?', points: 3, duplicate: false },
            { question: 'What is your biggest weakness?', points: 0, duplicate: true }
          ],
          problem: null,
          importable: 10
        }}
        skipDuplicates
        onSkipDuplicates={noop}
        onImport={noop}
        onExport={noop}
        result={null}
        onClose={noop}
      />
    </Frame>
  )
}

// ---- 4a: setup -------------------------------------------------------------

function Setup({ permissions }: { permissions: boolean }): JSX.Element {
  return (
    <Frame width={880} height={812}>
      <SetupScreen
        eyebrow="STARTS IN 6 MINUTES"
        title="Senior PM · Northwind · Round 2"
        sub="Priya Raman + one more · 45 min · Google Meet"
        stats={{ answers: 23, stories: 11, noStory: 2 }}
        meeting={
          permissions
            ? {
                ok: true,
                failed: false,
                title: 'Meeting audio · Google Meet tab',
                why: 'so it hears their questions',
                levels: [6, 13, 9, 14, 5]
              }
            : {
                ok: false,
                failed: true,
                title: 'Meeting audio',
                why: 'grant Screen Recording in System Settings → Privacy & Security',
                levels: null
              }
        }
        mic={
          permissions
            ? {
                ok: true,
                failed: false,
                title: 'Your mic · MacBook Pro',
                why: 'so it can tick off points as you say them',
                hasSignal: true
              }
            : {
                ok: false,
                failed: true,
                title: 'Your mic',
                why: 'grant Microphone access in System Settings → Privacy & Security',
                hasSignal: false
              }
        }
        keepTranscript={false}
        onToggleTranscript={noop}
        placement="docked"
        onPlacement={noop}
        placementError={null}
        canStart={permissions}
        onStart={noop}
        onEditBank={noop}
        onFixNoStory={noop}
        onTestMic={noop}
        onDryRun={noop}
      />
    </Frame>
  )
}

/** the desktop build's version of 4a: device pickers on both sources, the
 *  speech-model choice, and the mic test having actually reported back. Not
 *  part of the pinned design comparison — the mock predates all three — but
 *  this is the layout a real user sees, so it needs somewhere to be reviewed. */
function SetupDevices(): JSX.Element {
  const inputs = [
    { value: 'a', label: 'Your mic · MacBook Pro Microphone' },
    { value: 'b', label: 'Your mic · Jabra Evolve2 65' },
    { value: 'c', label: 'Your mic · BlackHole 2ch' }
  ]
  return (
    <Frame width={880} height={812}>
      <SetupScreen
        eyebrow="STARTS IN 6 MINUTES"
        title="Senior PM · Northwind · Round 2"
        sub="Priya Raman + one more · 45 min · Google Meet"
        stats={{ answers: 23, stories: 11, noStory: 2 }}
        meeting={{
          ok: true,
          failed: false,
          title: 'Meeting audio · BlackHole 2ch',
          why: 'so it hears their questions',
          levels: [6, 13, 9, 14, 5],
          picker: {
            options: [
              { value: '', label: 'Meeting audio · system capture' },
              { value: 'c', label: 'Meeting audio · BlackHole 2ch' }
            ],
            value: 'c',
            onChange: noop
          }
        }}
        mic={{
          ok: true,
          failed: false,
          title: 'Your mic · MacBook Pro Microphone',
          why: 'heard: “Tell me about a time you disagreed with a peer.”',
          hasSignal: true,
          levels: [6, 13, 9, 14, 5],
          picker: {
            options: [{ value: '', label: 'Your mic · system default' }, ...inputs],
            value: 'a',
            onChange: noop
          }
        }}
        model={{
          options: WHISPER_TIERS.map((t) => ({ value: t.id, label: `Speech model · ${t.label}` })),
          value: WHISPER_TIERS[0].id,
          onChange: noop,
          detail: WHISPER_TIERS[0].detail
        }}
        autoPick={{
          options: [
            { value: '4', label: 'Unsure: picks for me after 4s' },
            { value: '8', label: 'Unsure: picks for me after 8s' },
            { value: 'never', label: 'Unsure: waits for me' }
          ],
          value: '4',
          onChange: noop,
          detail: 'it commits the leader when the countdown runs out'
        }}
        highLegibility={false}
        onToggleLegibility={noop}
        keepTranscript
        onToggleTranscript={noop}
        placement="docked"
        onPlacement={noop}
        placementError={null}
        canStart
        onStart={noop}
        onEditBank={noop}
        onFixNoStory={noop}
        onTestMic={noop}
        testLabel="Test again"
        onDryRun={noop}
      />
    </Frame>
  )
}

// ---- 4b: armed -------------------------------------------------------------

function Armed(): JSX.Element {
  return (
    <Frame width={412} height={400}>
      <ArmedCard
        headline="23 answers loaded. I'll pull one up the moment they ask."
        openers={['Walk me through your background', 'Why this team?']}
        statusLeft="Nothing heard yet"
        onPause={noop}
      />
    </Frame>
  )
}

// ---- 9: recap (spec'd in the build brief, not in the mock) -----------------

function Recap({ transcriptKept }: { transcriptKept: boolean }): JSX.Element {
  const off = !transcriptKept
  const suffix = off ? ' · transcript off' : ''
  const excerpt = transcriptKept
    ? [
        {
          speaker: 'them' as const,
          text: 'Say a harassment complaint lands on your desk — how do you run the investigation?',
          highlight: 'harassment complaint'
        },
        {
          speaker: 'you' as const,
          text: "I'm careful about interview order — complainant first, then witnesses, the respondent last."
        }
      ]
    : null
  return (
    <Frame width={880} height={812}>
      <RecapScreen
        eyebrow="SESSION ENDED · 42 MINUTES"
        title="Senior People Partner · Meridian Health · Round 2"
        sub="9 questions heard · 7 matched to your bank"
        stats={{ covered: 26, totalPoints: 31, matched: 7, unmatched: 2 }}
        rows={[
          {
            id: 'r1',
            time: '02:04',
            question: 'Tell me about a time you handled a difficult employee relations case.',
            matched: true,
            subLine: `All 4 points covered${suffix}`,
            transcriptOff: off,
            coveredPct: 100,
            counter: '4/4',
            transcript: excerpt,
            onAddToBank: null
          },
          {
            id: 'r2',
            time: '08:12',
            question: 'Say a harassment complaint lands on your desk — how do you run the investigation?',
            matched: true,
            subLine: `Missed: named the actual number · what I'd do differently${suffix}`,
            transcriptOff: off,
            coveredPct: 75,
            counter: '3/4',
            transcript: excerpt,
            onAddToBank: null
          },
          {
            id: 'r3',
            time: '14:30',
            question: "What's your approach to pay transparency conversations?",
            matched: false,
            subLine: 'Not in your bank',
            transcriptOff: off,
            coveredPct: null,
            counter: null,
            transcript: null,
            onAddToBank: noop
          }
        ]}
        fixes={[
          {
            id: 'x1',
            title: 'Draft an answer from what I said',
            why: '“Pay transparency conversations” isn\'t in your bank yet',
            chip: 'Draft it',
            onAction: noop
          },
          {
            id: 'x2',
            title: 'You never said the 18% figure',
            why: "It's on the card but it didn't make it out loud",
            chip: 'Open answer',
            onAction: noop
          },
          {
            id: 'x3',
            title: 'Checkout redesign ran 2:40',
            why: 'Trim it to the two metrics that landed',
            chip: 'Edit story',
            onAction: noop
          },
          {
            id: 'x4',
            title: 'You pulled this one up by hand',
            why: 'Add the phrase they actually used as a trigger',
            chip: 'Add trigger',
            onAction: noop
          }
        ]}
        practiceCount={3}
        onDeleteSession={noop}
        onSaveToLoop={noop}
        onExport={noop}
        onPractice={noop}
      />
    </Frame>
  )
}

// ---- router ----------------------------------------------------------------

const SCREENS: Record<string, () => JSX.Element> = {
  live: LiveMatched,
  unsure: LiveUnsure,
  find: Find,
  strip: StripOverShare,
  'strip-queued': StripQueued,
  'strip-new': StripNew,
  bank: Bank,
  editor: Editor,
  importer: Importer,
  setup: () => <Setup permissions />,
  'setup-noperm': () => <Setup permissions={false} />,
  'setup-devices': SetupDevices,
  armed: Armed,
  recap: () => <Recap transcriptKept />,
  'recap-off': () => <Recap transcriptKept={false} />
}

export default function Gallery({ screen }: { screen: string }): JSX.Element {
  const Screen = SCREENS[screen]
  if (!Screen) {
    return (
      <div className="gallery gallery--index">
        <div className="label">SCREENS</div>
        {Object.keys(SCREENS).map((k) => (
          <a key={k} href={`?screen=${k}`} className="gallery-link">
            {k}
          </a>
        ))}
      </div>
    )
  }
  return <Screen />
}
