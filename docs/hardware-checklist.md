# Hardware checklist — what a container cannot prove

Everything in this app has been verified as far as a Linux container with no
audio hardware, one virtual display, and no macOS or Windows can verify it:
262 unit tests, a calibration suite against the real MiniLM, four probes
driving the built Electron app, a pixel gate, and a CI matrix that packages on
all three platforms.

None of that touches a microphone, a second monitor, a real screen share, or a
screen reader. This is the list of what to check on a real machine, why it
matters, and what "working" looks like. It is short on purpose — each item is
something that has genuinely been wrong before, or that the code reasons about
without ever having observed.

Run through it once on the machine you will interview on, ideally the evening
before rather than ten minutes prior.

## The interview path

**1. The mic test actually hears you** — setup screen, "Test".
It records five seconds through the real capture path and prints back what
Whisper heard. *Working:* the text roughly matches what you said. *Not
working:* empty, or wildly wrong — check the device picker on the mic row, and
press ⌘⇧D for the level in dB against the noise floor.

**2. Meeting audio arrives** (the half that differs per OS).
*Windows:* it should just work — loopback capture is native. *macOS:* install
BlackHole, route the meeting through a Multi-Output Device, pick it in the
meeting row. *Linux:* pick the "Monitor of …" source for whatever output the
meeting plays through. *Working:* the meeting dot is green and its level moves
when someone speaks in a test call.

**3. Practice mode against a real microphone** (P10 — never run against real
audio).
Bank → any entry → Practice, then say your answer aloud. *Working:* points
strike through as you make them, and the mini-recap shows coverage and your
speaking time. *Then check the firewall:* end it, and confirm the run does not
appear anywhere in your session history, and the entry's "last used" line is
unchanged.

**4. ⌘K takes your keystrokes while the meeting has focus** (C1).
With Zoom/Meet focused, press ⌘K and type. *Working:* the letters land in the
find overlay, not in the meeting's chat box. Press Esc: focus should return
toward the meeting app rather than leaving the panel in front.

**5. Sleep/wake and unplugging the mic mid-session** (C4).
Arm a session, then unplug the microphone (or sleep and wake the machine).
*Working:* within a few seconds a banner says the audio stopped. *Not working:*
the panel simply goes quiet and keeps looking healthy — that is the failure the
watchdog exists to prevent, and it has only ever been tested with a simulated
stall.

## Windows and screens

**6. Spaces and full-screen apps** (C6, macOS).
With the meeting full-screen on another Space, arm a session and let a question
land. *Working:* the panel or strip is visible over the meeting and does not
pull you out of the full-screen Space.

**7. Second monitor, then unplug it** (H14).
Drag the strip to a second display, quit, relaunch: it should reappear where you
left it. Now unplug that display and relaunch: it must land on a display that
still exists, not off-screen.

**8. Content protection in a real share** (M21).
Share your screen in Zoom or Meet with a second device watching. *macOS and
Windows:* the panel and strip must be absent from what the viewer sees.
*Linux:* they will be visible — the OS offers no way to exclude them — and the
strip should be showing its IN SHARE marker to tell you so.

## Accessibility and install

**9. Keyboard and screen reader** (P8).
Tab through the setup screen: every control should take focus with a visible
ring. Then turn on VoiceOver (macOS) or Narrator (Windows) and tab again —
buttons should announce as buttons with their labels. The ring was verified
in-browser; a real screen reader was not.

**10. The unsure-state keys, under pressure** (P1).
During a mock interview with a friend, when the panel is unsure, press 1 or 2
without looking. *Working:* the right card commits immediately. Also confirm a
bare digit does nothing while ⌘K is open or while you are typing in the bank.

**11. macOS 15 Gatekeeper** (README).
On a current macOS, double-click the packaged app, then System Settings →
Privacy & Security → "Open Anyway". *Working:* it launches on the second
attempt. The README documents this path from platform knowledge, not from a
verified install.

---

If something here fails, the diagnostics panel (⌘⇧D) names the most likely cause
in plain language, and REVIEW.md records what was already known to be fragile in
each area.
