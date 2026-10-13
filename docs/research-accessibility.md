# Cognitive accessibility & autism-friendly design for a personal money app
### Research findings for a solo-use, Japanese-UI money manager with recurring-subscription visibility

**Research date:** 2026-10-13
**Method note / limitation:** This container has no outbound DNS, so direct page fetches (WebFetch/curl) failed for every host. All findings below come from server-side web search, which returns extracted quotes and summaries rather than full pages. Where I could not see a paper's full text, I say so. Primary URLs are given so you can verify before building on anything load-bearing.

**Evidence strength key**
- 🟢 **Strong** — peer-reviewed study/meta-analysis, or a formal standard, with the specific claim directly supported.
- 🟡 **Moderate** — single study, small n, survey data, or a formal-but-non-normative guideline (e.g. W3C "informative" notes).
- 🔴 **Weak / common design advice** — practitioner consensus, blog guidance, unsourced statistics, or extrapolation from a different population/domain.

---

## 0. The single most important framing decision

Almost every autism-specific design guideline I found, from the GOV.UK posters to the 2023 Autistica/QMUL work to the ACM study below, ends in the same place: **individual variation is larger than the group difference, so the right answer is user control, not a fixed design choice.**

🟢 Sensory heterogeneity in autism is well documented: estimates of atypical sensory processing range from **60% to 97%** of autistic people depending on instrument, sensory features cluster into roughly **3–6 subtypes**, and **the same individual can be hypersensitive in one modality and hyposensitive in another**. ([Sensory Phenotypes in ASD: state-of-the-art review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12839194/), [Mapping sensory sensitivity in autism](https://pmc.ncbi.nlm.nih.gov/articles/PMC13410601/), [Uljarević et al. 2017, *Autism Research*](https://onlinelibrary.wiley.com/doi/10.1002/aur.1747) — which explicitly argues for "a dimensional construct … an 'individual differences' approach rather than categories")

**Concretely for this app:** because it is single-user and you are both the developer and the user, you have an advantage no commercial app has — you can *instrument the setting and then tune it on yourself over weeks*. The recommendation list below therefore separates:

- **Fixed design decisions** (things I'd build one way and not make configurable), and
- **Settings** (things where the evidence genuinely splits by individual and a toggle is the honest answer).

A proposed minimal settings surface is consolidated in **§7**.

This also matters because W3C's own Objective 8 is literally *"Support Adaptation and Personalization"*, with the pattern **Support a Personalized and Familiar Interface** covering "preferences on presentation such as font style, font size, line heights, margins, and contrast." ([W3C Objective 8](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o8-personalization/), [pattern o8p04](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p04-interface/)) 🟡 (formal guideline, non-normative)

---

## 1. Cognitive accessibility standards: what actually applies

### 1.1 The COGA document and its status

The document is **"Making Content Usable for People with Cognitive and Learning Disabilities"**, a W3C **Working Group Note** (published 2021-04-29) from the COGA Task Force. Status matters: it is **informative, not normative** — "the objectives and patterns provide supplemental guidance beyond the requirements of WCAG" and "following this guidance is not required for conformance to WCAG." ([W3C Note](https://www.w3.org/TR/coga-usable/), [design guide](https://www.w3.org/TR/coga-usable/design_guide.html), [editor's draft](https://w3c.github.io/coga/content-usable/))

It is organised into **8 objectives** containing roughly **50 design patterns**, each pattern structured as *user need → what to do → how it helps → examples*. ([W3C talk, 2021](https://www.w3.org/Talks/2021/0908-techexeter-coga11y/))

The patterns are also published as individually-addressable pages under [w3.org/WAI/WCAG2/supplemental/](https://www.w3.org/WAI/WCAG2/supplemental/) — that index is the most practical place to work from.

**The eight objectives:**

| # | Objective | Page |
|---|---|---|
| 1 | Help Users Understand What Things Are and How to Use Them | [o1](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o1-understandable/) |
| 2 | Help Users Find What They Need | — |
| 3 | Use Clear and Understandable Content | [o3](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/) |
| 4 | Help Users Avoid Mistakes and Know How to Correct Them | [o4](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o4-minimize-mistakes/) |
| 5 | Help Users Focus | [o5](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o5-user-focus/) |
| 6 | Ensure Processes Do Not Rely on Memory | [o6](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o6-memory/) |
| 7 | Provide Help and Support | — |
| 8 | Support Adaptation and Personalization | [o8](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o8-personalization/) |

### 1.2 Reducing working-memory load

🟡 W3C's Objective 6 page states the operative number directly: **"a person with an impaired working memory may be able to remember one to four pieces of information at the same time."** Its patterns are:
- Provide a Login that Does Not Rely on Memory or Other Cognitive Skills
- Allow the User a Simple, Single Step, Login
- Provide a Login Alternative with Less Words
- Let Users Avoid Navigating Voice Menus
- **Do Not Rely on Users Calculations or Memorizing Information**

([W3C Objective 6](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o6-memory/))

Objective 4 adds the finance-specific note that **"many users with cognitive and learning disabilities cannot remember numbers, such as zip or post codes or their social security number."** ([W3C Objective 4](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o4-minimize-mistakes/))

**Concretely:**

| Don't | Do |
|---|---|
| Show "¥32,450 spent this month" and leave the user to compute the remainder against a budget they must recall. | Show the *derived* number as the headline: "残り ¥17,550 / 10日" ("remaining / days left"). The user should never do arithmetic. This is the pattern **Do Not Rely on Users Calculations or Memorizing Information**. |
| Put the subscription total on one screen and the month's spending on another, requiring the user to hold one while reading the other. | Any two numbers that need comparing must be **co-located in one viewport**. If the design requires scrolling between them, it has failed. |
| Any password/PIN on a solo-use local app. | No auth at all, or device biometric/passkey only. W3C: logins should not require "memorizing character strings, performing calculations, copying, solving puzzles, [or] reproducing gestures reliably" — approaches named include WebAuthn public-key credentials, federated login, and QR-code login. ([2020 design guide](https://www.w3.org/TR/2020/WD-coga-usable-20201211/design_guide.html)) |
| A category picker that assumes the user remembers which category they used for this merchant last time. | Store and re-present the last-used category per merchant. The information lives in the app, not the head (see §3.3 on externalizing). |

### 1.3 Clear, unambiguous language

🟡 Objective 3's 13 patterns, verbatim from the W3C page: **Use Clear Words; Use a Simple Tense and Voice; Avoid Double Negatives or Nested Clauses; Use Literal Language; Keep Text Succinct; Use Clear, Unambiguous Formatting and Punctuation; Include Symbols and Letters Necessary to Decipher the Words; Provide Summary of Long Documents and Media; Separate Each Instruction; Use White Spacing; Ensure Foreground Content is not Obscured by Background; Explain Implied Content; Provide Alternatives for Numerical Concepts.** ([W3C Objective 3](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/))

Two of these do real work here:

**Use Literal Language** — see §2.2, this is also the single most consistent autism-specific finding.

**Explain Implied Content** — a money app is full of implied content. "固定費" (fixed costs) implies a definition the app has chosen. "¥0" in a weekly-total cell implies either *nothing is due* or *no data* — those are different states and must look different.

**Concretely:**

| Don't | Do |
|---|---|
| Button labelled 「確認」 or 「OK」. | Label the button with the action and its consequence: 「この支出を記録する」. The GOV.UK autism poster's don't-list is explicit about "Click here"-style vague labels. ([GOV.UK](https://accessibility.blog.gov.uk/2016/09/02/dos-and-donts-on-designing-for-accessibility/)) |
| 「予算をオーバーしています」 (ambiguous: by how much? since when?) | 「10月の食費は予算より ¥3,200 多いです」 — subject, amount, period, all explicit. |
| A blank cell, a dash, and ¥0 used interchangeably. | One visual treatment per state, with a word: 「未記録」 vs 「¥0（支出なし）」. |

### 1.4 Consistent, predictable layout

🟢 **WCAG 2.2** gives you the normative floor here:
- **3.2.3 Consistent Navigation** (AA) and **3.2.4 Consistent Identification** (AA) — repeated navigation in the same relative order; same function identified the same way.
- **3.2.6 Consistent Help** (Level **A**, new in 2.2) — help mechanisms that repeat across pages stay in the same place relative to other content, so users don't have to search for help.
- **3.3.7 Redundant Entry** (Level **A**, new in 2.2) — don't make users re-enter information already given in the same process; auto-populate or make it selectable.
- **3.3.8 Accessible Authentication** (AA) / **3.3.9** (AAA) — no cognitive function test in login.

([Deque WCAG 2.2 summary](https://dequeuniversity.com/resources/wcag-2.2), [PowerMapper](https://www.powermapper.com/blog/wcag-2.2-released/) — note that at least one secondary source miscategorises 3.2.6 and 3.3.8 as AAA; the A/AA/AA/AAA assignment above is the one three independent sources agree on, but verify against [w3.org/TR/WCAG22/](https://www.w3.org/TR/WCAG22/) if it matters formally.)

🟡 COGA Objective 1 adds the patterns **Use a Familiar Hierarchy and Design** and **Use a Consistent Visual Design**. ([W3C Objective 1](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o1-understandable/))

**Concretely:**

| Don't | Do |
|---|---|
| A bottom nav whose items reorder, or whose count changes by context (e.g. a "Review" tab that appears only at month end). | Fixed set, fixed order, always present. If month-end review is a thing, it is a *state of an existing tab*, not a new tab. |
| Expense-entry fields in a different order on the dashboard quick-add vs. the full add screen. | Identical field order everywhere. Quick-add is the *same form with fields collapsed*, not a different form. |
| Re-asking for payment method / category on a correction flow. | 3.3.7 Redundant Entry: edit prefills everything; the user changes only what's wrong. |

### 1.5 Time limits — avoid entirely

🟢 **WCAG 2.2.1 Timing Adjustable** requires that time limits can be turned off, adjusted, or extended. 🟡 COGA's related pattern is **Avoiding Data Loss and Timeouts** (under Objective 4), and the design guide describes warning users before a timeout and telling them their data will be kept. ([W3C Objective 4](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o4-minimize-mistakes/), [2020 design guide](https://www.w3.org/TR/2020/WD-coga-usable-20201211/design_guide.html))

**Concretely:** no session timeout, no auto-dismissing toasts that carry the only copy of information, no "you have 30 seconds to undo" that actually discards. A toast with Undo is fine *if* the action is also reversible from the record afterwards. **Draft expense entries must survive app backgrounding, force-quit, and reboot** — persist on every keystroke, not on submit. This is the one that will actually bite in practice.

### 1.6 Error prevention and recovery

🟡 Objective 4's 12 patterns (W3C page wording): *Ensure controls and content don't move unexpectedly; Letting users go back; Notifying users of fees and charges at the start of a task; Designing forms to prevent mistakes; Making it easy to undo form errors; Using clear visible labels; Using clear step-by-step instructions; Accepting different input formats; Avoiding data loss and timeouts; Providing feedback; Helping the user stay safe; Using familiar metrics and units.* The guide's rationale: "users should always be able to check their work and correct any mistakes … the ability to undo errors reduces the consequences that result from a mistake." ([W3C Objective 4](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o4-minimize-mistakes/), [4.5.5 in the 2020 draft](https://www.w3.org/TR/2020/WD-coga-usable-20201211/design_guide.html))

🟢 **WCAG 3.3.1 Error Identification**, **3.3.3 Error Suggestion**, **3.3.4 Error Prevention (Legal, Financial, Data)** — 3.3.4 requires reversible / checked / confirmed for financial transactions.

**Accepting different input formats** is the highest-value pattern here and the one most apps get wrong.

**Concretely:**

| Don't | Do |
|---|---|
| Reject `1,200` or `1200円` or `１２００` (full-width) in the amount field. | Normalize on input: strip commas, 円/¥, full-width digits, spaces. **Accept Different Input Formats.** Japanese IMEs produce full-width digits constantly; rejecting them is a self-inflicted error source. |
| Inline validation that fires on every keystroke and paints the field red while the user is still typing. | Validate on blur or submit. Mid-typing red is a false error — it trains the user to ignore red. |
| An "Are you sure?" modal on every save. | Reserve confirmation dialogs for irreversible, high-consequence actions only (deleting a whole month, wiping data). Everything else gets **Undo**. NN/g: confirmation dialogs "prevent user errors" only if not overused, and designers should "go to great lengths to provide undo." ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)) 🟡 — this is heuristic guidance; I found **no controlled A/B study comparing confirm-vs-undo on error rates**, so treat the magnitude as unknown even though the direction is agreed. |
| Error text that only says what's wrong. | 3.3.3 Error Suggestion: say what to do. 「金額を入力してください（例：1200）」 |

### 1.7 Making current state obvious

🟡 COGA Objective 5 (*Help Users Focus*) patterns: **Limit Interruptions; Make Short Critical Paths; Avoid Too Much Content; Provide Information So a User Can Complete and Prepare for a Task.** Its rationale: "distractions can prevent users with cognitive and learning disabilities from completing their tasks. Once users become distracted, they may find it difficult to remember what they were doing" — with clear headings and breadcrumbs as the recovery mechanism. ([W3C Objective 5](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o5-user-focus/))

**Concretely:** every screen answers three questions without scrolling — *where am I, what period am I looking at, what is the one number that matters.* A dashboard that shows 「¥32,450」 without 「10月（残り10日）」 adjacent to it has failed. Period selection must be a visible, persistent control showing its current value, never an invisible default.

---

## 2. Autism-specific design considerations

### 2.1 The evidence base, honestly

The strongest single source I found is 🟡 **"Web Design for People on the Autism Spectrum: A Mixed-Methods Study on Digital Barriers"** ([doi 10.1145/3820253.3831390](https://doi.org/10.1145/3820253.3831390)) — two studies (an online survey comparing autistic and neurotypical participants, then a follow-up email survey). Its five headline barriers:

1. **Sensory overload**
2. **Colour and contrast problems**
3. **Lack of control over content**
4. **Unpredictability**
5. **Unclear page structure**

The paper's framing claim is that these **go beyond what WCAG 2.2 covers** — WCAG mostly targets sensory and motor impairments, leaving cognitive/perceptual needs less addressed. Autistic respondents reported more sensory overload than neurotypical respondents and rated the same design elements as more stressful. **Caveat:** I could not retrieve sample sizes, effect sizes, or the full recommendation list; only the abstract/intro were visible. Verify before citing numbers.

🟡 **Autistica / Queen Mary University of London (2023), "Making online platforms autism-friendly"** — gathered and analysed autistic social media users' posts, interviews, then a workshop with autistic adults. Key finding: **"the sensory needs of autistic people are rarely considered in digital design."** Focus-group participants named **pop-ups, auto-playing videos, and multiple simultaneous audio/visual stimuli** as barriers. Two toolkits accompany it, one for developers/designers. ([Autistica news](https://www.autistica.org.uk/news/accessible-online-spaces), [PDF](https://www.autistica.org.uk/downloads/files/Making-online-platforms-autism-friendly_2023-09-14-104201_rtau.pdf), [QMUL policy brief](https://www.qmul.ac.uk/mei/policy-hub/queen-mary-policy-briefs/making-online-platforms-autism-friendly/))

🟡 **UK Home Office "Dos and don'ts on designing for accessibility" (Karwai Pun, 2016)** — a set of six posters; the autistic-spectrum one is directly relevant. ([GOV.UK accessibility blog](https://accessibility.blog.gov.uk/2016/09/02/dos-and-donts-on-designing-for-accessibility/))

| Do | Don't |
|---|---|
| Use simple colours | Use bright, high-contrast colours |
| Write in plain language | Use figures of speech and idioms |
| Use simple sentences and bullets | Create walls of text |
| Make buttons descriptive ("Attach files") | Make vague buttons ("Click here") |
| Build simple, consistent layouts | Build busy, cluttered layouts |

Critically, **the author flags the internal conflict herself**: strong contrast is recommended for low-vision users while "some autistic users would prefer otherwise," and she recommends testing with users to find the balance. She also describes the posters as "general good practice rather than strict rules." A commenter raised that autistic users often read language literally so euphemisms *and over-simplified icons* may not be understood — and Pun's reply emphasised individual differences. **Treat the posters as a hypothesis generator, not a spec.**

### 2.2 Literal vs figurative language

This is the most consistently supported autism-specific recommendation across every source: the GOV.UK poster, COGA's **Use Literal Language** pattern, and the literal-reading point raised in the GOV.UK comment thread. 🟡

**Concretely for this app** — and note that Japanese finance UI is *full* of metaphor:

| Don't | Do |
|---|---|
| 「お財布に優しい」「家計が火の車」 — metaphor | 「今月は予算より ¥3,200 少なく使いました」 |
| 「ちょっと使いすぎかも？」 — hedged, implies a judgement the app hasn't defined | 「食費：予算 ¥30,000 / 実績 ¥33,200」 — state the facts, let the user judge |
| 「サブスク貧乏」-style framing, gamified mascot commentary | No commentary. Numbers and labels only. |
| An icon alone to mean a category | Icon **plus** text label, always. The GOV.UK comment thread specifically flags over-simplified icons as unintelligible, and COGA's pattern is **Use Icons that Help the User**, not icons instead of words. |

**Caveat on "plain language":** COGA's clear-language patterns were developed primarily for English. 「簡単な日本語」 is not the same thing as plain English — e.g. *Avoid Double Negatives or Nested Clauses* maps badly onto Japanese, where 「〜ないわけではない」 and heavy left-branching modification are the real offenders. 🔴 I found **no Japanese-specific cognitive-accessibility language guide** with the same granularity. Digital Agency's ウェブアクセシビリティ導入ガイドブック is the Japanese government document, and it does name 学習障害・知的障害・発達障害 as beneficiary groups and calls for 「サービス全体像の分かりやすい提示」 and 「カテゴリー・機能の絞り込み」, but it is an introductory guidebook, not a plain-Japanese style guide. ([Digital Agency DS-671.2 PDF](https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/08ed88e1-d622-43cb-900b-84957ab87826/bf5f4482/20251016_introduction_to_web_accessibility.pdf), [WAIC commentary](https://waic.jp/news/ciaj-column-26/))

### 2.3 Sensory load: colour, contrast, motion, sound

**Colour.** 🔴→🟡 The most-cited study is a 2016 Frontiers in Psychology study of **29 autistic boys vs 38 neurotypical boys** which found autistic boys were more likely to prefer green and brown and **significantly less likely to prefer yellow** (the highest-luminance hue tested), with hypersensitivity to high luminance as the proposed mechanism. A later study reportedly found participants with high sensory sensitivity "consistently preferred soft, low-saturation colors." **This is children, n≈29, and reached me via secondary sources** — do not treat it as an adult finding. ([via Sheri Byrne-Haber](https://www.sheribyrnehaber.com/accessible-color-choices-are-about-so-much-more-than-just-contrast/))

🟡 A Japanese autistic designer's account reports that 視覚過敏 can make even a white notebook feel 「発光しているように眩しい」, and that a green-tinted background was less burdensome. ([note.com / Yuu Yamasaki](https://note.com/yuu_yamasaki/n/n2c990795995f)) This is first-person testimony, not a study — but it's testimony from a Japanese-language context, which is scarce and worth having.

**The actual constraint is saturation and luminance, not contrast ratio.** Byrne-Haber's point is the one to build on: **WCAG sets a contrast minimum and no maximum, and no success criterion addresses saturation at all.** So a design can pass AA and still be sensorily overwhelming. Pure #000 on #FFF is the worst case for photophobia while being maximally compliant.

**Concretely:**
- Fixed: never pure white background, never pure black text. Use e.g. `#1A1D21` on `#F4F1EC` — still well above 4.5:1. A muted palette can clear AAA: `#4a5568` is **7.0:1 on white**.
- Fixed: colour is never the only carrier of meaning (WCAG 1.4.1). Over-budget is 「超過 +¥3,200」 with a label, not just red.
- **Setting:** background tint (warm off-white / cool off-white / light green / dark) — this is exactly where individual variation is largest and a toggle is cheap.
- **Fixed, and this one matters more than palette:** avoid red/green as the primary budget semantic. The expense-app design critique literature independently flags "guilt-inducing red/green budget indicators" as a churn driver 🔴, and red-as-failure interacts badly with the gamification concerns in §2.5. Prefer a neutral-to-emphasis ramp (grey → amber) over green→red.

**Motion.** 🟢 **WCAG 2.3.3 Animation from Interactions (AAA)** covers motion triggered by user action; **2.2.2 Pause, Stop, Hide** covers auto-moving content. Sufficient techniques: **C39** (CSS `prefers-reduced-motion`), **SCR40** (same query in JS), and a general technique of letting users set a preference that stops animation. The vestibular rationale is explicit in C39. Animation is exempt only if essential — "a progress indicator showing file upload status" is the W3C's own example. ([Understanding 2.3.3](https://w3c.github.io/wcag/understanding/animation-from-interactions.html), [Deque](https://dequeuniversity.com/resources/wcag2.1/2.3.3-animations-from-interactions), [C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html))

🟡 The Japanese autistic-designer account names the specific offenders: auto-advancing carousels, animations overlapping text, background parallax, infinite horizontal text loops — and proposes a site-level play/pause control placed at the top. ([note.com](https://note.com/yuu_yamasaki/n/n2c990795995f))

**Concretely:**
- Fixed: honour `prefers-reduced-motion: reduce` — kill transitions, transforms and chart draw-in animations, keep non-motion feedback (background-colour change, a check mark).
- Fixed: **no chart entrance animations by default.** A bar chart that grows on every dashboard visit is motion on every single app open. Draw it at final state.
- Fixed: no parallax, no auto-carousels, no number count-up animations (「¥0 → ¥32,450」 counting up is both motion and a brief period of *wrong information on screen*).
- **Setting:** an in-app "アニメーションを減らす" toggle in addition to the OS query. The OS setting is global and the user may want it only here. One guide recommends the in-app control be easily discoverable and persist across sessions. 🔴

**Sound.** 🟡 Autistica's focus groups named auto-playing audio as a barrier. **Concretely: no sound at all, ever, including no haptic-plus-sound save confirmation.** If you want save feedback, use a visual state change. 🔴 (consensus, not studied)

### 2.4 Predictability, surprise, and modal interruptions

🟡 "Unpredictability" is one of the five barriers in the ACM mixed-methods study. 🟡 Autistica's participants named **pop-ups** explicitly. 🟡 COGA has both **Limit Interruptions** ("avoid using any content or elements that distract users or interrupt them") and **Ensure controls and content don't move unexpectedly.**

🟡 **Monotropism** gives a theoretical reason why interruptions are costlier for autistic users specifically. Murray, Lesser & Lawson (2005) argue that autistic attention is concentrated in few channels, and that shifting attention requires broadly distributed attention which intense focus crowds out. ([monotropism.org](https://monotropism.org/murray-lesser-lawson/), [*Autism* 9(2)](https://journals.sagepub.com/doi/pdf/10.1177/1362361305051398)) **Status caveat, stated plainly:** a 2026 review concludes the evidence is *partial* — "some findings are consistent with the theory, and some direct tests have been less clear," and direct tests of monotropism have given mixed results, though it is "probably the dominant theoretical approach" within the autistic adult community. ([SimplyPsychology review](https://www.simplypsychology.com/articles/monotropism-autism)) Use it as a design heuristic, not a citation of fact.

**Concretely:**

| Don't | Do |
|---|---|
| Any modal that appears without the user having just acted — rating prompts, tips, "did you know", "you haven't logged in 3 days". | **Zero uninvited modals.** Information the app wants to volunteer goes into a persistent, dismissible area on the dashboard that the user reads when they choose. This is pull, not push. |
| Layout that shifts as data loads (skeleton → content of different height). | Reserve final layout height. Content that appears must not displace content already read. **Ensure controls and content don't move unexpectedly.** |
| A FAB that moves, or a nav bar that hides on scroll. | Static chrome. |
| Toast notifications that stack and cover the thing just acted on. | One slot, fixed position, fixed height, never over the save button. |
| Surprise state: app opens on a different tab than last time. | Open on the same screen every time (**setting**: default tab). Predictability of the *entry point* is the cheapest predictability win available. |

### 2.5 Progress indicators and gamification — the contested area

This is where I want to be most careful, because it's where you're most likely to be given a confident wrong answer.

**What the evidence actually says:**

🟡 A **systematic review and meta-analysis of gamified digital health interventions for children and adolescents with ASD** proposes that "reward-based feedback loops embedded in gamified tasks can enhance intrinsic motivation and sustain engagement." I could only see the discussion section, not pooled effect sizes. ([*Child Adolesc Psychiatry Ment Health*](https://link.springer.com/article/10.1186/s13034-025-01009-w))

🟡 A **feasibility RCT of PuzzleWalk**, a gamified app for **adults** with ASD, targeting physical activity and anxiety, compared against Google Fit. Feasibility trials are small and not powered for efficacy. ([JMIR Formative Research 2022](https://formative.jmir.org/2022/7/e35701))

🔴 A literature review argues built-in rewards (points, levels, progress bars) "may reinforce autistic players and keep them engaged" — conceptual argument, not measured. ([FIRAH review](https://www.firah.org/upload/activites-et-publications/progammes-thematiques/autisme-nouvelles-technologies/autisme-et-jeux/uk-gamification-in-autism.pdf)) A narrative review of gamified environments for autistic students reports "unanimous agreement" on positive impact on self-control and autonomy — narrative review, weak. ([PMC10173233](https://pmc.ncbi.nlm.nih.gov/articles/PMC10173233/))

**What the evidence does *not* say — and this is the important part:**

🔴 **I found no study testing streaks or streak-loss mechanics in autistic users, at any age.** None. The entire gamification evidence base above is (a) mostly children, (b) mostly learning/therapy contexts, not self-management, and (c) silent on loss-framed mechanics. I also found no study on whether rewards can backfire for autistic users by reducing intrinsic interest. **Anyone who tells you "streaks are bad for autistic people" or "streaks are great" is extrapolating.**

**My reading of the tradeoff, stated as a tradeoff:**

- The *positive* evidence is for **reward-based feedback on task completion** in structured learning contexts, with children.
- Streaks are a different mechanic: they are **loss-framed** (you lose something by not acting) and they **create an obligation that persists when the user is unwell or overwhelmed**. That is structurally in tension with the one thing all the autism design literature agrees on — reducing unpredictable pressure — and with COGA's **Avoid Having a Time Limit** / data-loss concerns, since a streak is a time limit with emotional stakes.
- Separately and concretely for *this* app: a streak rewards *logging*, not *managing money well*. If the goal is "manage money properly," a streak optimises a proxy. On a day with no spending there is nothing to log, so a naive streak either breaks (punishing good behaviour) or requires a "no-spend" tap (busywork).

**Concretely — what I'd build:**

| Don't | Do |
|---|---|
| Streaks, combo counters, "don't break the chain", badges, levels, confetti. | A **completeness indicator with no loss framing**: 「10月：23日分 記録済み / 31日」 — a fact, not a score. No "broken" state, no red, no exclamation. |
| Progress bar toward a budget that fills red as you approach it. | A **position indicator**: a horizontal marker showing where today sits in the month next to where spending sits. Two neutral marks, no fill-and-flash. |
| "You're doing great!" / "Oops, you missed 3 days." | Nothing. No evaluative language in either direction. (Literal-language finding, §2.2, applies to praise too — "doing great" is unfalsifiable and the user cannot tell what it refers to.) |
| **Setting**, not a fixed choice: | Whether completeness/progress indicators appear at all. Some users find them orienting; some find any quantified-self display pressuring. Given there is genuinely **no evidence either way**, make it a toggle and observe yourself over a month. |

### 2.6 Routine and structure

🟡 Built-environment research on autism identifies **sensory quality, intelligibility, and predictability** as the three key design factors ([scoping review, PMC8003767](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8003767/)) — physical-space research, so an analogy, but the triad transfers cleanly and three independent literatures (physical space, COGA, the ACM web study) converge on it.

**Concretely:** design the app around **one recurring ritual**, not continuous engagement. Pick a fixed, user-chosen moment (e.g. 「毎晩21:00に今日の支出を確認」) and make that the app's shape: a single screen that is *the* daily screen, which can be completed and closed. An app that is always partially incomplete and always has something to do is the opposite of routine-supporting. **Completability is a feature.**

---

## 3. Executive function and money management

### 3.1 Is the premise even true? Partly — and less than you'd think

🟢 **Financial literacy and confidence are lower in autistic adults.** Galizzi, Hillier & Schena (2023), *Journal of Consumer Affairs* 57(4), 1650–1683, [doi:10.1111/joca.12564](https://onlinelibrary.wiley.com/doi/10.1111/joca.12564): autistic adults compared with a **matched** non-autistic group showed "lower financial literacy and great uncertainty around many financial issues," and "were less confident of their financial knowledge and ability to deal with daily financial matters." The study also found the autistic group showed **less liking for some specific learning tools** for receiving financial education — relevant: don't assume a tutorial or a course-like onboarding will land.

🟡 A study of **62 autistic adults (18–60) vs 61 matched non-autistic adults** on financial risk preference reports "understanding of risk diversification is significantly lower among autistic individuals," while noting "mixed evidence regarding their ability to manage financial decisions compared to other groups." ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S2214635025000462))

🟡 **Executive function in autism: impairment is found consistently, but *which* domain is inconsistent** — "there are consistent findings of EF impairment in ASD across child, adolescent and adult samples but inconsistent findings in respect of the domain of function(s) that is impaired." ([PMC6751156](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6751156/)) **Design implication: do not design for a specific assumed deficit.** Design so that *no* EF domain is load-bearing.

**Now the corrective, which matters:**

🟢 **Time perception in autistic adults is NOT reliably impaired.** The Casassus et al. (2019) systematic review in *Autism Research* concludes "it cannot be inferred that there is a generalised time perception impairment in autism or an impairment in their internal clock." ([Wiley](https://onlinelibrary.wiley.com/doi/full/10.1002/aur.2170)) The largest adult study (58 autistic, 91 non-autistic) found **questionnaire-reported differences but comparable timing performance.** ([PubMed 35467931](https://pubmed.ncbi.nlm.nih.gov/35467931)) Some studies find deficits on naturalistic but not comprehensive tasks; one time-production study found autistic participants had **superior** performance. ([PMC12021712](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12021712/))

🟢 **Prospective memory in autistic adults is also contested.** A 2023 Virtual Week study found time-based worse than event-based ([Springer](https://link.springer.com/article/10.1007/s10803-023-05975-y)); a 2025 experience-sampling study found the **reverse** (time-based *superior*, group difference not significant) ([*Autism Research*](https://onlinelibrary.wiley.com/doi/full/10.1002/aur.70057)); a 2026 study of 64 adults found **no group differences on either task** after controlling for verbal ability ([*Autism Research* aur.70250](https://onlinelibrary.wiley.com/doi/10.1002/aur.70250), [PMC13276686](https://pmc.ncbi.nlm.nih.gov/articles/PMC13276686/)). Groenman et al. (2024) also report spared PM ([*Autism*](https://journals.sagepub.com/doi/10.1177/13623613231225489)).

🔴 **"Time blindness"** as applied to money appears in this research only via clinical blogs, not peer-reviewed work — e.g. psychiatry-uk.com framing money problems as arising from "working memory, time blindness, prioritising and emotional regulation." ([psychiatry-uk.com](https://psychiatry-uk.com/money-time-and-the-neurodivergent-brain-why-managing-finances-can-feel-so-hard/)) The term is popular and useful as a self-description; it is **not an established construct with measured financial consequences in autism.**

🟡 **Interoception:** I found **no study** linking interoception to time estimation or to financial behaviour in autistic adults. The interoception→money chain is unevidenced. I'd drop it as a design justification.

🟡 **The ADHD overlap is the more relevant literature for the money-specific claims.** ">40% of adults in a recent study also met diagnostic criteria for ADHD" ([PMC11811128](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11811128/)), and the ADHD-finance evidence is where late payments, debt, and steeper delay discounting actually show up — e.g. Koerts et al. (2023) on everyday financial knowledge and judgment in ADHD; Beauchaine et al. (2020, *Science Advances*) on ADHD, financial distress and suicide. 🔴 I could only see these as titles/references, not findings. **Flag:** importing ADHD findings into an autism design rationale is an extrapolation, even though comorbidity is high.

**What this means for the app's design rationale:** build for **EF support without assuming a specific deficit**, and justify it by *the app's own job* (making invisible recurring costs visible) rather than by claimed time-perception deficits that the literature does not support.

### 3.2 Why future expenses are hard to anticipate, and why recurring charges go unnoticed

This is the one place where the evidence is genuinely strong, and it is **not** autism-specific — it's universal, which is a *better* justification, not a worse one.

🟢 **Einav, Klopack & Mahoney, "Selling Subscriptions"** (NBER/SSRN; presented to the FTC). Design: transaction data from a large payment-card network, exploiting **card replacements (e.g. at expiration)**, which force the subscriber into an active renewal decision. Finding: **cancellations rise sharply in the months when cards are replaced, across all ten subscription services studied.** The authors model it as inattention or switching costs and say the data can't cleanly separate them; holding the initial subscriber pool fixed, these frictions **roughly double seller revenue on average** (drafts report ranges from +89% average, and 14% to >200% across services; estimated attention parameters 0.04–0.50). **Inattention is higher among consumers who took cash advances**, used as a proxy for lower financial sophistication. ([FTC-hosted PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/klopackeinavmahoney.pdf), [Stanford copy](https://nmahoney.people.stanford.edu/sites/g/files/sbiybj23976/files/media/file/subscriptions.pdf), [SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4539925), [discussant notes](https://www.ftc.gov/system/files/ftc_gov/pdf/strulov-shlain_susbscriptions_discussion_ftc16.pdf))

**This is the single most important finding in this report.** It establishes, with real transaction data rather than self-report, that:
1. Large numbers of people pay for subscriptions they would cancel if they thought about them.
2. **The effective intervention is a forced active decision**, not more information.

🟡 **C+R Research (2022):** consumers *estimated* ~**$86/month** on subscriptions; itemising their actual charges came to **$219/month**. ~**1/3 underestimate by $100–199**, another **24% by $200+**. **42% said they had forgotten they were still being charged** for a subscription they no longer used. **86% have at least some subscriptions on autopay**, and the report ties autopay directly to not noticing. ([CNBC](https://www.cnbc.com/2022/06/02/consumers-spend-133-more-monthly-on-subscriptions-than-they-realize.html), [CNBC follow-up](https://www.cnbc.com/2022/09/06/consumers-underestimate-monthly-subscription-costs-by-at-least-100.html)) 🔴 A widely-repeated West Monroe figure (89% underestimate; 66% off by >$200) recurs across secondary sites; **I could not locate the primary report** — don't cite it.

🔴 The term **"subscription blindness"** does not appear as a named concept in any research I could find. The phenomenon is real and measured; the label is marketing.

### 3.3 Externalizing information — making invisible things visible

🟢 **Cognitive offloading** is a well-established framework: Risko & Gilbert (2016) define it as acting on the world to change a task's processing demands. ([Risko & Gilbert 2016](https://www.researchgate.net/publication/306352756_Cognitive_Offloading); [Gilbert 2020, *JEP:General*, PDF](https://samgilbert.net/pubs/Gilbert2020JEPG.pdf))

Key findings that bear on design:
- 🟢 **Offloading genuinely improves performance**, "particularly at higher memory loads."
- 🟢 **People are strongly biased toward using external reminders — even when financially incentivised not to** (Gilbert 2020). People who doubt their memory set more reminders.
- 🟢 **Metacognitive beliefs predict whether people offload at all** — i.e. if the user doesn't believe they'll forget, they won't record it. This is a design problem: the app must make recording cheap enough that it happens *before* the belief check.
- 🟢 **The trade-off is not free:** Risko & Gilbert characterise it as a shift from "remembering *what*" to "remembering *where*." Sparrow et al. (2011): when people expect future access, they recall *location* better than *content*.
- 🟡 One replication found **no support for the compensation hypothesis** — people with poorer memory did *not* offload more or benefit more.

**Concretely:**
- The "remembering where" shift means **the app must be the single place**. If subscription data lives partly in the app and partly in the user's head ("I know Netflix is in there somewhere"), offloading has made things worse. One canonical list, and **no subscription may exist in the user's life without a row in it** — which implies a frictionless "add a subscription I just remembered" path reachable from anywhere.
- Because offloading is biased *toward* reminder use, the risk isn't that the user won't set reminders — it's that reminders accumulate and habituate (§5.3).

### 3.4 Friction reduction and habit formation

🟡 **Implementation intentions** (if-then plans): Gollwitzer & Sheeran (2006), *Advances in Experimental Social Psychology* 38, 69–119, [doi:10.1016/S0065-2601(06)38002-1] — **94 independent tests, d = .65** (medium-to-large). **Honest caveat, which most sources omit:** this meta-analysis predates modern publication-bias correction; one secondary source reports bias-corrected figures as low as **d = 0.35, and d = 0.15 after further adjustment** (I could not verify against a primary source). Effects are **smaller for difficult, long-term goals than for one-off actions** — which is exactly our case. ([goalsandprogress summary](https://goalsandprogress.com/implementation-intentions-gollwitzer-how-to/), [consistencycalendar](https://consistencycalendar.com/science/implementation-intentions)) So: 🟡 overall, downgraded from the headline 🟢.

**Concretely:** support an explicit if-then plan *as data in the app*, not as advice text. e.g. a one-time setup screen: 「コンビニを出たら、すぐアプリに記録する」 stored and shown at the top of the entry screen. The mechanism is situational-cue delegation, so the cue must be concrete and user-authored.

### 3.5 Impulse spending and cooling-off periods

🟡 The evidence is **mixed and duration-dependent**, and the nuance is actionable:

From a Michigan dissertation on designing for self-control in e-commerce ([deepblue.lib.umich.edu](https://deepblue.lib.umich.edu/items/b4da4889-a5bd-4fd5-a8c6-5b940df3b972)):
- A **25-hour delay** lowered felt urge to buy and purchase intent. ✅
- A **10-minute delay** on Amazon purchases produced **no statistically significant drop** in impulse purchases or dollars spent — attributed partly to participants continuing to shop during the delay. ❌
- **~3.5 minutes spent actively listing reasons for and against** the purchase, **or** a distracting task, **did** reduce urge and purchase intent. ✅
- Conclusion: a delay works when it's long enough for the urge to fade, **or** short but spent reflecting.

🟡 A separate field study with **107 participants on a real e-commerce site** found all tested interventions reduced impulse urges (baseline: two minutes' unguided waiting), though user experiences varied. ([bckwon.com PDF](https://www.bckwon.com/pdf/purchase.pdf))

🔴 Popular "24-hour rule / 30% reduction" figures are unsourced. Ignore.

**Concretely:**

| Don't | Do |
|---|---|
| A 10-minute or 1-hour "cooling off" timer. Evidence says short passive delays don't work. | A 「検討中」 (considering) list with **a 24-hour-plus minimum** before the item can be marked purchased. The *duration* is the active ingredient. |
| An empty wait. | Attach **two text fields** to each considering-item: 買う理由 / 買わない理由. This is the ~3.5-minute active-reflection condition, which worked even when short. Make it the *required* step to add the item, not an optional one. |
| A modal that blocks a purchase. | The app can't block anything (it isn't in the payment path) and shouldn't pretend to. It's a **pre-commitment surface the user opts into**, which is the only honest framing for a solo app. |

🟡 Japanese practitioner guidance from 就労移行支援 providers independently converges on the same mechanics for 発達障害 adults: 「購入前に一定期間置く『ワンクッション』」, 「具体的な数値でルールを設定し、曖昧さを排除する」, and for ASD specifically 「『金額』ではなく『個数』で制限する」 — limit by *count*, not amount. ([ディーキャリア](https://dd-career.com/column_data/money-management-methods-for-developmental-disorders/), [PLUS INNOVATION](https://plusinnovation.jp/blogdetail?wgd=blog-97)) 🔴 These are support-provider blogs, not studies — but the count-not-amount idea is a genuinely novel, cheap feature (「今月のサブスク契約数：7件（上限8件）」) and worth trying.

### 3.6 Does making spending visible actually change spending? Mostly no — manage expectations

🟢 This is the finding most likely to save you from building the wrong thing. **Grubb et al. (2025), *The Journal of Finance*** — UK bank field experiments auto-enrolling customers in just-in-time text alerts: **unarranged overdraft charges fell 17–19%**, but **"spending reductions are economically small"** and "consumers' spending is relatively inelastic to these alerts." **Early-warning alerts: incremental benefits statistically insignificant.** ([Wiley](https://onlinelibrary.wiley.com/doi/full/10.1111/jofi.13404), [BC news](https://www.bc.edu/bc-web/sites/bc-news/articles/2025/spring/study-shows-text-message-alerts-significantly-reduce-overdrafts.html))

🟢 FCA Occasional Paper 40 (2018), two UK banks, **>1 million customers**: average saving **£0.28–0.45 per month** in overdraft charges from a real-time arranged-overdraft alert; evidence for early-warning alerts weak; **no statistically significant evidence that low-balance alerts help consumers avoid unarranged overdrafts.** ([FCA](https://www.fca.org.uk/publications/occasional-papers/occasional-paper-no-40-time-act-field-experiment-overdraft-alerts), [FinCap](https://www.fincap.org.uk/en/evaluations/a-field-experiment-on-overdraft-alerts))

**Concretely — set the app's goal accordingly.** Alerts and visibility reliably help people **avoid specific, discrete, avoidable costs** (a fee, an unwanted renewal). They do **not** reliably reduce general discretionary spending. So:
- ✅ The subscription-cancellation use case is **well supported**: it's a discrete, avoidable, forgettable cost — exactly the shape the Einav/Grubb evidence says interventions work on.
- ❌ A general "spend less" ambition driven by dashboard visibility is **not** well supported. Don't build guilt mechanics in service of a goal the evidence says they won't achieve.
- 🔴 The **pain-of-paying** literature (Prelec & Loewenstein 1998; insula activation on cash payment; cash as a more salient stimulus than card/phone) is often invoked to argue manual logging recreates the pain of paying. The cash-vs-card effect is well documented, **but a WVU dissertation notes the pain construct itself "has not been directly measured" — researchers use surrogates, and "the evidence on the relationship between these surrogate measures and pain is non-conclusive."** ([dissertation](https://researchrepository.wvu.edu/cgi/viewcontent.cgi?article=8603&context=etd), [Frontiers 2019](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2019.01188/full), [BehavioralEconomics.com](https://www.behavioraleconomics.com/resources/mini-encyclopedia-of-be/pain-of-paying/)) **So "manual entry creates useful friction" is a plausible hypothesis, not a finding.** See the conflict in §4.3.

---

## 4. Data-entry burden

### 4.1 What's actually established

🟢 **The strongest claim available, and it's enough:** in the personal-informatics literature, **"people are more likely to abandon the use of apps and devices in tracking domains where the burdens of collecting data are higher."** ([Epstein dissertation, Univ. of Washington](https://digital.lib.washington.edu/researchworks/bitstreams/c791fe4c-ebc3-4708-b5c6-ae111d5a0dde/download))

🟢 **The lived informatics model** (Epstein, Ping, Fogarty & Munson, 2015) replaces a linear funnel with a cycle: deciding to track → selecting a tool → tracking & acting → **lapsing** → possibly resuming. It names **four lapse types: forgetting, upkeep, skipping, suspending.** ([Semantic Scholar](https://www.semanticscholar.org/paper/A-lived-informatics-model-of-personal-informatics-Epstein-Ping/95a186d42b161c401ffc7d9ce47167e2510abb04))

🟢 **"Reconsidering the device in the drawer"** (UbiComp 2016), **141 former Fitbit users**: lapses are something designs should *respond to*, not prevent. ([doi](https://doi.org/10.1145/2971648.2971656)) And **Epstein et al., "Beyond Abandonment to Next Steps" (CHI 2016, 1109–1113)** shows designs keep influencing people after they stop. ([related](https://digital.lib.washington.edu/researchworks/bitstreams/c791fe4c-ebc3-4708-b5c6-ae111d5a0dde/download))

🟡 **Clark, Southerton & Driller (2024)**: "discontinuance is not a clean stop … usage is often episodic." ([*New Media & Society*](https://journals.sagepub.com/doi/abs/10.1177/14614448221083992))

🟡 **Semi-automated tracking** (Choe and colleagues) is the designed middle ground — "combines both manual and automated data collection methods," motivated by the observation that "complete automation of data collection significantly reduces the awareness, accountability, and involvement achieved when a person actively engages in manual tracking," and that "little evidence shows that automated health activity tracking leads to behavior change." **SleepTight** (UbiComp 2015) reduced capture burden by keeping only essential fields — "behavior type and time" — rather than detailed quantities, over a 4-week deployment. **OmniTrack** (IMWUT 2017) lets users mix manual fields with automatic retrieval via triggers. ([SleepTight PDF](http://faculty.washington.edu/jkientz/papers/Choe-SleepTight-UbiComp2015.pdf), [OmniTrack PDF](https://terpconnect.umd.edu/~choe/download/IMWUT-2017-Kim-OmniTrack.pdf), [project page](https://info.umd.edu/projects/advancing-personal-informatics-through-semi-automated-tracking/)) **Caveat:** Choe's group frames this as a hypothesis under investigation; **I found no controlled comparison isolating semi-automation's effect on adherence.**

🟡 **Japanese sources converge on the same mechanism** — the dominant stated reason 家計簿 fails is 入力の手間 plus 後回し leading to an unrecoverable backlog, and 完璧主義 / 細かすぎる分類 at setup. ([41fp.com](https://41fp.com/money_media/lifestyle/kakeibogatutukanaihito/), [tfp-group](https://tfp-group.co.jp/media/domestic-accounts-book-not-continue/), [note](https://note.com/sss3yai/n/n54ff5c6fad06)) 🔴 Zaim's claim that ~70% of 家計簿 users have abandoned it at least once has no cited source. One source makes a genuinely useful counter-point: **receipt-OCR correction work can be more annoying than typing** ([hokkaidougurashi](https://hokkaidougurashi.com/budget-app-stick-with-it/)).

🔴 **Do not use these numbers** — they circulate widely and all trace to unsourced blog or developer content: "manual-logging apps lose users at 3x the rate," "68% stop using the app rather than reconnect a broken bank link," "bank integration → 68% higher retention," "percentage progress displays → 43% higher D30 retention," "Apptopia 2024: 38% average D30 retention for personal finance apps," "manual tracking reduces spending 15–20%."

### 4.2 Concretely: the entry interaction

The SleepTight finding — **keep only essential fields; drop detailed quantities** — is the one to build on, plus COGA's *Make Short Critical Paths*.

**Target: amount + save, with everything else inferred and correctable.**

| Don't | Do |
|---|---|
| Require category, payment method, date, and memo on every entry. | **Amount is the only required field.** Everything else gets a default and is editable afterwards. An uncategorised expense with a correct amount is vastly more valuable than no expense. |
| A category dropdown. | Tap-chips that **default to the last-used value**, ordered by the user's own frequency. (This pattern recurs across every quick-entry implementation I looked at: "category and payment method … default to whatever you used last time.") 🔴 practitioner convergence, not studied. |
| Open the app → navigate → tap add → form. | **Home-screen widget or OS share/shortcut with its own keypad**, auto-focused amount field, Today/Yesterday toggle, save, auto-close. Observed pattern across quick-entry implementations: *"own keypad, Today/Yesterday, category chips in the widget's order … then Undo / One more and auto-close."* 🔴 |
| Save → return to dashboard. | Save → **stay, clear amount, keep category/date, refocus the amount field**, offer "もう1件" and Undo. Logging is bursty; the second entry is the likely one. 🔴 |
| Reject full-width or comma-formatted amounts (see §1.6). | Normalize silently. |
| Make the user *decide* what the date is. | Default to today. Yesterday is one tap. Anything older is behind a disclosure. |

### 4.3 ⚠️ Conflict: lapses, backfill, and whether friction is good

**Three recommendations in this report pull against each other. You have to choose.**

**(a) Design for lapses, support backfill** (lived informatics, 🟢). People will lapse — "forgetting, upkeep, skipping, suspending" — and the app should let them resume without penalty. That argues for easy bulk backfill of missed days.

**(b) Manual entry may be doing useful work** (pain-of-paying / semi-automated-tracking rationale, 🟡/🔴). If the value of logging is the moment-of-purchase awareness, then backfilled entries are *bookkeeping with no behavioural benefit* — and the Japanese accounts of 週末にまとめて入力 describe exactly the failure mode where batched entry becomes the burden that kills the habit.

**(c) Reduce burden to the floor** (🟢 abandonment↔burden). Which argues for full automation — bank/card sync — eliminating entry altogether. But Choe's rationale says full automation "significantly reduces the awareness, accountability, and involvement" that manual tracking provides.

**My resolution, and you should treat it as a judgement call, not a finding:**

1. **Automate the data that has no behavioural value in being manual: recurring subscriptions.** A monthly Netflix charge has no moment-of-purchase decision — the decision was made once, months ago. Entering it manually 12×/year is pure burden. **Subscriptions should be defined once and projected forward automatically.** This is the clean win and it's also the app's stated purpose.
2. **Keep discretionary spending manual, but make it 2-tap**, and accept imperfect coverage. Explicitly design for incomplete data: the dashboard must be honest and useful at 70% coverage (「23日分 記録済み / 31日」), never implying totals are complete when they aren't.
3. **Allow backfill, but never ask for it.** No "you have 8 days unlogged" nag. A quiet, reachable path for the user who wants it. Per "Beyond Abandonment," the design's job at a lapse is to offer a next step, not to extract compliance.
4. **Do not implement bank/card sync, even if available.** For a solo local app it adds a failure mode (broken connections), a privacy surface, and the categorisation work that sync-based apps are criticised for anyway — while removing the awareness effect. **Flagging this as a genuine judgement call:** the burden↔abandonment evidence (🟢) points the other way, and if you find after a month that manual entry simply isn't happening, syncing card data for *totals* while keeping manual entry for *things you want to notice* is the semi-automated compromise the literature actually recommends.

---

## 5. Subscription visibility UX

### 5.1 What makes a recurring cost noticeable again

Three mechanisms have real support. In order of strength:

**(1) 🟢 A forced active decision.** This is the Einav/Klopack/Mahoney finding (§3.2): cancellations spike when a card replacement compels an active renewal choice. **Information alone did not produce those cancellations — a required decision did.**

**Concretely — this is the feature I'd build first:**
- A **subscription re-confirmation cycle**: each subscription carries a 「最終確認日」. When it ages past a user-set interval (3 months is a reasonable default), the row enters a 「要確認」 state and the dashboard shows 「3件のサブスクが確認待ち」.
- The review interaction is a **binary active choice per subscription**: 「継続する」 / 「解約を検討する」. **Not** a dismiss. Not an "OK". The whole mechanism is that the user must *decide*, and a decision has two outcomes.
- Confirming sets a new date; the row leaves the state. **This artificially recreates card expiry**, which is the only intervention in this report with transaction-level evidence behind it.
- Keep the review **bounded and completable** (§2.6): "3 items, then done," never an endless queue.

**(2) 🟡 Temporal reframing / aggregation.** Gourville (1998), *Journal of Consumer Research* 24(4), 395–408 coined "pennies-a-day": a one-time aggregate cost restated as small recurring amounts ($350/yr → $1/day) is evaluated more favourably. The mechanism is **comparison retrieval** — "$1 a day" recruits comparisons to trivial expenses. A 2011 follow-up argues it's the per-day *comparison*, not the per-day *wording*, that drives it. Crucially: **"a less aggregate expense is preferred to a more aggregate one"** — and **the effect weakens and reverses as the base cost grows** ("as the size of the base cost increases, the pennies-a-day strategy becomes ineffective and in fact reverses"). It also works better for ongoing than lump-sum products. ([EconPapers](https://econpapers.repec.org/RePEc:oup:jconrs:v:24:y:1998:i:4:p:395-408), [Bambauer-Sachse & Grewal 2011 PDF](https://www.dhruvgrewal.com/wp-content/uploads/2014/09/2011-JR-Temporal-Prices.pdf), [moderators](https://link.springer.com/article/10.1023/A:1025467002310))

**Concretely — run it in reverse.** Sellers disaggregate to make costs feel small; a money app should **aggregate to make them feel real**:

| Don't | Do |
|---|---|
| Lead with 「月額 ¥980」 per row. | Lead with **annual**: 「年額 ¥11,760」, monthly as the secondary line. |
| Show only a monthly subscription total. | Show the **annual total as the headline number** on the subscription screen: 「サブスク合計：年 ¥142,000」. |
| — | Add an **opportunity-cost comparison**, because the mechanism is comparison retrieval, not number size: 「年 ¥142,000 = 給料の約X日分」 or against a named savings goal. 🟡 This is extrapolation from Gourville to a reversed use case — the direction is well supported, the magnitude in this context is not tested. |

**Important honesty flag:** Gourville's own boundary condition is that the effect *reverses* at large base costs. Nobody has tested reverse-aggregation for salience in a personal-finance app. Rated 🟡, direction-only.

**(3) 🟢 Varying the form of a repeated prompt (polymorphism).** This is the best-evidenced answer to "how do I stop something fading into the background," and it comes from security-warning research:
- fMRI: **a sharp drop in visual-processing activity after only the second exposure** to a warning, with further decline after. ([BYU ScholarsArchive 9306](https://scholarsarchive.byu.edu/facpub/9306/))
- **Polymorphic warnings** — ones that change appearance — produced **smaller drops in neural activity** than static ones, both within a session and longitudinally. ([ResearchGate 300725460](https://www.researchgate.net/publication/300725460_How_Polymorphic_Warnings_Reduce_Habituation_in_the_Brain), [longitudinal fMRI](https://scholarsarchive.byu.edu/facpub/9293/))
- Over a 5-day workweek, attention to warnings fell, **partly recovering across days without exposure**. ([seminar abstract](https://events.comp.nus.edu.sg/view/14234))
- **Field evidence:** a 3-week field study of app privacy-permission warnings found **adherence dropped more slowly for polymorphic warnings.** Replicated with mouse-cursor tracking, n=80. ([Tuning Out Security Warnings](https://www.researchgate.net/publication/325361021_Tuning_Out_Security_Warnings_A_Longitudinal_Examination_of_Habituation_Through_fMRI_Eye_Tracking_and_Field_Experiments1), [BYU 1955](https://scholarsarchive.byu.edu/facpub/1955))
- Caveats: fMRI n=25, university setting.

**This directly conflicts with the autism predictability/consistency guidance. See §6.1.**

### 5.2 How existing tools do it

🟡/🔴 (product descriptions and third-party reviews; I could not use the apps)

**Rocket Money (ex-Truebill)** — a dedicated **Recurring** tab in the bottom nav; each subscription shows company, amount, **and the annual amount**; a **7-day calendar of upcoming charges** plus a list of later ones; a **"payday" view** putting recurring spend on one calendar against due dates; a **"Safe to Spend"** figure derived from income, upcoming bills, subscriptions and card payments. Detection heuristic per a third-party review: near-identical amounts from the same merchant at ~30-day intervals — and it reportedly **misses app-store-bundled payments, family-plan splits paid via P2P, and annual renewals with no monthly pattern.** Notably, **I found no evidence of a headline subscriptions-only monthly total.** ([robberger.com](https://robberger.com/rocket-money-review/), [clark.com](https://clark.com/save-money/rocket-money-review/), [fiscify](https://fiscify.com/blog/rocket-money-subscription-tracker-review/))

**Bobby (iOS)** — main screen lists subscriptions **sorted by next payment date**; colour-coded cards with logos; a **clear monthly cost total**; handles weekly/monthly/n-monthly/annual cycles and can display **average weekly, monthly, or annual cost**, as a sum or a monthly average; per-subscription reminders set N days/weeks ahead. Review complaints worth learning from: **the countdown rounds too coarsely** ("1 week" for something 10 days away), **weekly total sometimes shows ¥0 when payments are due**, notifications have broken in updates, and users want a home-screen widget. ([MacStories](https://www.macstories.net/reviews/bobby-subscription-tracking-made-easy/), [App Store](https://apps.apple.com/us/app/bobby-track-subscriptions/id1059152023))

**Japanese apps** — サブスクBox: pick a plan, get monthly total **plus annual equivalent**, next-billing notifications (some services only show annual). Costly: free iOS, **a visual bar showing time remaining until each next payment**, and normalises mixed annual/monthly into a 月平均. マネーフォワード ME: detects fixed-rate services from linked account/card debit history (free tier limits linked accounts; Premium ¥500/mo). Zaim: category-based 定期支出 visualisation. ([app-liv](https://app-liv.jp/lifestyle/finance/3903/), [note: サブスクBox](https://note.com/dreamy_cougar568/n/n2457c1410c89), [lomworks: Costly](https://lomworks.com/blog/best-subscription-management-apps-costly), [subsc-select-lab](https://subsc-select-lab.com/subscription-management-app-recommended/))

**What to take, what to leave:**
- ✅ Take: **sort by next payment date** (Bobby) — turns the list into a timeline.
- ✅ Take: **annual figure on every row** (Rocket Money, サブスクBox) — aligns with §5.1(2).
- ✅ Take: **time-remaining bar** (Costly) — a spatial, pre-attentive encoding of "soon," which is more glanceable than a date.
- ✅ Take: **normalise mixed cycles to a comparable monthly figure** (Costly, Bobby) — but show the real cycle too; a ¥12,000/yr item is not a ¥1,000/mo item on the day it bills.
- ❌ Leave: **auto-detection from transaction history.** Rocket Money's own documented miss-rate (app-store bundles, annual renewals, P2P splits) means detection produces a list that is *silently incomplete* — the worst possible property for a tool whose whole purpose is making sure nothing is invisible. **Manual definition with a frictionless add path is more trustworthy for a solo app.**
- ❌ Leave: coarse countdown rounding (Bobby's "1 week" at 10 days) and ambiguous ¥0 cells (§1.3 — ¥0 vs no-data must look different).

### 5.3 Keeping it salient without creating notification fatigue

🟢 Combining the habituation evidence (§5.1(3)) with the alert-effectiveness evidence (§3.6):
- Repeated **identical** prompts lose effect from the **second exposure**.
- Alerts work on **discrete avoidable costs**, not general spending.
- Attention **partly recovers after days without exposure** — so *frequency* is itself a design variable: fewer, spaced prompts preserve their own effectiveness.

**Concretely:**

| Don't | Do |
|---|---|
| A daily or weekly subscription-total push notification. | **Push only for discrete, actionable, date-bound events**: a renewal within N days for an item flagged 要確認, or a first charge after a free trial. Everything else is **pull** — the dashboard, read when the user opens the app. (Also satisfies §2.4: no uninvited interruptions.) |
| The same alert copy every month. | **Vary the presentation of the periodic review prompt** — rotate which framing leads (annual total / count of subscriptions / the longest-unreviewed item / cost per use). Grounded in the polymorphic-warning field evidence. **But see §6.1 — this conflicts with predictability, and must be a setting.** |
| A permanent badge/red dot on the subscription tab. | A badge only when there is a **bounded, completable** action behind it (「3件 確認待ち」). A badge that is always on is invisible within a week — the second-exposure finding applies to badges too. |
| An endless feed of "insights". | One periodic review, bounded, with a defined end state. |

---

## 6. Conflicts and tradeoffs — read this section

These are the places where two well-supported recommendations in this report genuinely disagree. I'm not resolving them for you.

### 6.1 ⚠️ Polymorphic variation (anti-habituation) **vs** predictability and consistency

- 🟢 Varying a repeated prompt's appearance measurably sustains attention and adherence (fMRI + 3-week field study + n=80 replication).
- 🟡 "Unpredictability" is one of five headline barriers for autistic web users (ACM mixed-methods study); COGA mandates **Use a Consistent Visual Design**; GOV.UK says build simple, consistent layouts.

**These cannot both be fully satisfied.** The variation that defeats habituation *is* unpredictability.

**Partial resolution I'd propose:** separate **structure** from **content**.
- **Structure stays absolutely fixed**: same tab, same position, same layout, same interaction, same place on screen, always.
- **Content varies**: which framing of the same underlying fact leads (annual total vs. count vs. oldest-unreviewed vs. cost-per-use). The user always knows *where* the prompt is and *what kind of thing* it is; only the specific sentence differs.
- This is untested. The polymorphic-warning studies varied *visual appearance* (colours, borders, imagery), which is the part I'm specifically recommending against here — so I'm applying their finding to a different manipulation than the one they tested. 🔴 for this specific resolution.
- **Make it a setting.** 「確認メッセージの表示を毎回変える」 default **off**. Predictability is the better-established need for this user population; anti-habituation is the better-established mechanism for the specific job. Only the user can resolve that, and only over time.

### 6.2 ⚠️ Low saturation / muted palette **vs** contrast minimums

- 🟡 Autistic users and the GOV.UK poster point toward muted, low-saturation, non-bright palettes; first-person Japanese testimony reports white backgrounds reading as 「発光しているように眩しい」.
- 🟢 WCAG 1.4.3 requires 4.5:1 for body text; low contrast is independently argued to increase cognitive load and slow task completion.

**This conflict is mostly resolvable and is widely overstated.** WCAG sets a *minimum with no maximum* and **says nothing about saturation**. `#4a5568` on white is 7.0:1 (AAA) and is a muted grey. So: **desaturate and reduce luminance extremes, don't reduce contrast ratio.** The genuinely irreducible conflict is only at the two edges — sub-4.5:1 "soft" designs (don't), and pure-black-on-pure-white maximal contrast (also don't). ([Byrne-Haber](https://www.sheribyrnehaber.com/accessible-color-choices-are-about-so-much-more-than-just-contrast/), [Univ. of Reading](https://www.reading.ac.uk/digital-accessibility/resources/accessible-use-of-colour), [GOV.UK — author's own acknowledgement of the conflict](https://accessibility.blog.gov.uk/2016/09/02/dos-and-donts-on-designing-for-accessibility/))

**Setting:** background tint + a dark theme. Not a fixed decision.

### 6.3 ⚠️ Minimise entry burden **vs** manual entry's awareness value

Covered in detail in §4.3. Summary: 🟢 burden predicts abandonment; 🟡/🔴 the awareness benefit of manual entry is a plausible hypothesis with indirect support only. **My call: automate subscriptions (no decision moment to preserve), keep discretionary manual (decision moment exists), and accept incomplete coverage rather than adding sync.** But this is the single most reversible decision in the app and worth re-testing on yourself.

### 6.4 ⚠️ "Avoid too much content" **vs** some autistic users prefer dense information

- 🟡 COGA Objective 5 pattern **Avoid Too Much Content**; GOV.UK: don't create walls of text.
- 🟡 But: the heterogeneity evidence (§0) and participatory-design accounts explicitly push back on blanket minimalism — one participatory account pushes back even on the standard advice to avoid images behind text.
- There is also a real information-architecture cost to minimalism *in this app specifically*: §1.2 requires that numbers needing comparison be **co-located in one viewport**. Aggressive progressive disclosure directly works against that.

**Resolution: a density setting, with the *same* information in both modes.** 「表示：標準 / 詳細」 — detailed mode shows per-row annual + monthly + next date + days-since-review inline; standard mode shows amount + next date and puts the rest behind a tap. **Critically: do not make minimal mode a different information model** — the same facts, differently packed. Switching modes must never change what the user can learn.

### 6.5 ⚠️ A money app's purpose **vs** what visibility actually achieves

🟢 §3.6: alerts cut specific avoidable fees by 17–19% but barely move general spending. If the app is built and judged on "did it make me spend less overall," the evidence predicts disappointment, and the likely response is adding guilt mechanics — which the autism-design evidence says are harmful and the retention literature says drive abandonment. **Define success as "no subscription I don't want is still charging me" and "I know what my fixed monthly outgoings are," both of which are achievable.** Not "I spent less."

---

## 7. Proposed settings surface (the consolidated "make it configurable" list)

Each of these is a place where the evidence genuinely splits by individual, or where I could find no evidence at all. **Defaults given are my best guess, not findings.**

| Setting | Options | Default | Why it's a setting, not a decision |
|---|---|---|---|
| Background tint | warm off-white / cool off-white / soft green / dark | warm off-white | §6.2; luminance sensitivity varies, same person can differ by modality (§0) |
| Reduce animation | on / off (in addition to OS `prefers-reduced-motion`) | on | OS setting is global; user may want it only here |
| Information density | 標準 / 詳細 | 標準 | §6.4; genuine split, same info either way |
| Show completeness indicator | on / off | on | §2.5; **no evidence either way** on whether quantified completeness motivates or pressures |
| Vary review-prompt wording | on / off | **off** | §6.1; direct conflict between two well-supported findings |
| Default screen on open | dashboard / subscriptions / quick-add | dashboard | predictability of entry point (§2.4); which one is personal |
| Subscription review interval | 1 / 3 / 6 months | 3 months | §5.1(1); the interval has no evidence behind it, only the mechanism does |
| Push notifications | per-event-type, all off by default | all off | §5.3; attention recovers with spacing, and uninvited interruption is a named barrier |
| Considering-list minimum wait | 24h / 48h / 72h | 24h | §3.5; 25h worked, 10min didn't; the floor is evidenced, the exact value isn't |
| Currency display of subscriptions | annual-first / monthly-first | annual-first | §5.1(2); direction evidenced, individual preference unknown |

---

## 8. If you build only five things

Ranked by evidence strength × impact, not by effort.

1. **Subscription re-confirmation cycle with a binary active choice** (§5.1(1)) — the only mechanism in this report backed by transaction-level field evidence that people actually cancel things they don't want. 🟢
2. **Annual figure as the headline on every subscription row and on the subscription total** (§5.1(2)) — cheap, and runs a well-documented seller tactic in reverse. 🟡
3. **Amount-only required entry, reachable from the home screen, staying open after save** (§4.2) — burden predicts abandonment is the strongest finding in the self-tracking literature. 🟢
4. **No uninvited modals, no sound, no entrance animations, `prefers-reduced-motion` honoured, muted-but-compliant palette** (§2.3, §2.4) — convergent across every autism source; also the cheapest to get right at the start and the most expensive to retrofit. 🟡
5. **Undo everywhere; confirmation dialogs only for irreversible destruction; full-width/comma-tolerant number parsing; drafts persisted on every keystroke** (§1.6, §1.5) — error *recovery* over error *prevention*, and the Japanese-IME input-format issue will otherwise generate a false error on a large fraction of entries. 🟡

---

## 9. Where I'd want better evidence before committing

Honest gaps, so you know what's thin:

- **Streaks / loss-framed mechanics in autistic users: no studies at all.** Anything stated about this, here or elsewhere, is extrapolation (§2.5).
- **Reverse temporal aggregation for salience: untested.** Gourville tested disaggregation-to-sell; nobody has tested aggregation-to-notice, and his own boundary condition says the effect reverses at large base costs (§5.1(2)).
- **Polymorphic *content* (vs polymorphic *appearance*): untested.** My §6.1 resolution applies the finding to a different manipulation than the one studied.
- **Confirm-vs-undo: no controlled comparison found.** NN/g heuristic only (§1.6).
- **Semi-automated tracking: no controlled adherence comparison.** Choe's group frames it as a hypothesis (§4.1).
- **Plain-Japanese cognitive accessibility: no granular guide found.** COGA's language patterns are English-shaped; Digital Agency's guidebook is introductory (§2.2). If the UI is Japanese, this is a real gap worth filling by testing wording on yourself.
- **Autistic *adult* colour preference:** the cited study is 29 autistic boys. Do not treat as an adult finding (§2.3).
- **Interoception → money: no link found in the literature.** I'd drop it (§3.1).
- **The ACM mixed-methods study's actual numbers and recommendations** — I only had access to the abstract/intro. Worth getting the full paper ([doi 10.1145/3820253.3831390](https://doi.org/10.1145/3820253.3831390)), and the Autistica developer toolkit PDF ([link](https://www.autistica.org.uk/downloads/files/Making-online-platforms-autism-friendly_2023-09-14-104201_rtau.pdf)), both of which this container's DNS block prevented me from reading directly.

---

## Sources

**Standards**
- [W3C, Making Content Usable for People with Cognitive and Learning Disabilities (WG Note, 2021)](https://www.w3.org/TR/coga-usable/) · [design guide](https://www.w3.org/TR/coga-usable/design_guide.html) · [editor's draft](https://w3c.github.io/coga/content-usable/) · [2020 WD design guide](https://www.w3.org/TR/2020/WD-coga-usable-20201211/design_guide.html)
- W3C supplemental guidance index: [all patterns](https://www.w3.org/WAI/WCAG2/supplemental/) · [O1](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o1-understandable/) · [O3](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/) · [O4](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o4-minimize-mistakes/) · [O5](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o5-user-focus/) · [O6](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o6-memory/) · [O8](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o8-personalization/) · [o8p04 personalized interface](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p04-interface/) · [o8p03 simplification](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p03-complexity/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Deque WCAG 2.2 updates](https://dequeuniversity.com/resources/wcag-2.2) · [PowerMapper release notes](https://www.powermapper.com/blog/wcag-2.2-released/) · [Understanding 2.3.3](https://w3c.github.io/wcag/understanding/animation-from-interactions.html) · [Technique C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html)
- [デジタル庁 ウェブアクセシビリティ導入ガイドブック DS-671.2](https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/08ed88e1-d622-43cb-900b-84957ab87826/bf5f4482/20251016_introduction_to_web_accessibility.pdf) · [WAIC解説](https://waic.jp/news/ciaj-column-26/)

**Autism-specific design**
- [Web Design for People on the Autism Spectrum: A Mixed-Methods Study on Digital Barriers (ACM)](https://doi.org/10.1145/3820253.3831390)
- [Autistica / QMUL, Making online platforms autism-friendly (2023) — PDF](https://www.autistica.org.uk/downloads/files/Making-online-platforms-autism-friendly_2023-09-14-104201_rtau.pdf) · [news](https://www.autistica.org.uk/news/accessible-online-spaces) · [policy brief](https://www.qmul.ac.uk/mei/policy-hub/queen-mary-policy-briefs/making-online-platforms-autism-friendly/)
- [Karwai Pun, Dos and don'ts on designing for accessibility, GOV.UK (2016)](https://accessibility.blog.gov.uk/2016/09/02/dos-and-donts-on-designing-for-accessibility/)
- [Murray, Lesser & Lawson (2005), Attention, monotropism and the diagnostic criteria for autism](https://journals.sagepub.com/doi/pdf/10.1177/1362361305051398) · [monotropism.org](https://monotropism.org/murray-lesser-lawson/) · [critical review](https://www.simplypsychology.com/articles/monotropism-autism)
- [Uljarević et al. (2017), Heterogeneity of sensory features in ASD](https://onlinelibrary.wiley.com/doi/10.1002/aur.1747) · [Sensory phenotypes review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12839194/) · [Mapping sensory sensitivity](https://pmc.ncbi.nlm.nih.gov/articles/PMC13410601/)
- [Byrne-Haber, Accessible colour choices are about more than contrast](https://www.sheribyrnehaber.com/accessible-color-choices-are-about-so-much-more-than-just-contrast/) · [Univ. of Reading, accessible use of colour](https://www.reading.ac.uk/digital-accessibility/resources/accessible-use-of-colour)
- [発達障害当事者デザイナーとウェブアクセシビリティ②アニメーションについて](https://note.com/yuu_yamasaki/n/n2c990795995f)
- [Built environment design and ASD: scoping review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8003767/)

**Gamification**
- [Meta-analysis: gamified digital health interventions in ASD youth](https://link.springer.com/article/10.1186/s13034-025-01009-w) · [PuzzleWalk feasibility RCT, adults with ASD](https://formative.jmir.org/2022/7/e35701) · [FIRAH gamification-in-autism review](https://www.firah.org/upload/activites-et-publications/progammes-thematiques/autisme-nouvelles-technologies/autisme-et-jeux/uk-gamification-in-autism.pdf) · [Gamified environments review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10173233/)

**Executive function, finance, EF interventions**
- [Galizzi, Hillier & Schena (2023), Financial literacy among autistic adults, *J Consum Aff*](https://onlinelibrary.wiley.com/doi/10.1111/joca.12564)
- [Autistic adults, financial risk preference, and economic outcomes](https://www.sciencedirect.com/science/article/abs/pii/S2214635025000462)
- [EF: cognition and behaviour in adults with ASD](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6751156/) · [EF as transdiagnostic endophenotype of autism–ADHD](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11811128/)
- [Casassus et al. (2019), Time perception and ASC: systematic review](https://onlinelibrary.wiley.com/doi/full/10.1002/aur.2170) · [largest adult timing study (null)](https://pubmed.ncbi.nlm.nih.gov/35467931) · [atypical time-to-contact estimation](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12021712/)
- PM in autistic adults: [Nürnberg et al. 2026 (null)](https://onlinelibrary.wiley.com/doi/10.1002/aur.70250) · [Faustmann 2025 (time-based superior)](https://onlinelibrary.wiley.com/doi/full/10.1002/aur.70057) · [Virtual Week 2023 (time-based worse)](https://link.springer.com/article/10.1007/s10803-023-05975-y) · [Groenman et al. 2024](https://journals.sagepub.com/doi/10.1177/13623613231225489)
- [Risko & Gilbert (2016), Cognitive Offloading](https://www.researchgate.net/publication/306352756_Cognitive_Offloading) · [Gilbert (2020), Optimal Use of Reminders, *JEP:General*](https://samgilbert.net/pubs/Gilbert2020JEPG.pdf)
- [Gollwitzer & Sheeran (2006) summary, d=.65](https://goalsandprogress.com/implementation-intentions-gollwitzer-how-to/) · [second summary + bias caveat](https://consistencycalendar.com/science/implementation-intentions)
- [Impulse buying: designing for self-control with e-commerce (dissertation)](https://deepblue.lib.umich.edu/items/b4da4889-a5bd-4fd5-a8c6-5b940df3b972) · [field study of self-controlled purchase interventions](https://www.bckwon.com/pdf/purchase.pdf)
- [ディーキャリア 発達障害と金銭管理](https://dd-career.com/column_data/money-management-methods-for-developmental-disorders/) · [PLUS INNOVATION ADHD/ASD特性別](https://plusinnovation.jp/blogdetail?wgd=blog-97) · [psychiatry-uk, money/time/neurodivergent brain](https://psychiatry-uk.com/money-time-and-the-neurodivergent-brain-why-managing-finances-can-feel-so-hard/)

**Pain of paying / alerts**
- [WVU dissertation on pain-of-payment measurement](https://researchrepository.wvu.edu/cgi/viewcontent.cgi?article=8603&context=etd) · [Frontiers in Neuroscience 2019, payment salience](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2019.01188/full) · [BehavioralEconomics.com entry](https://www.behavioraleconomics.com/resources/mini-encyclopedia-of-be/pain-of-paying/)
- [Grubb et al. (2025), Sending Out an SMS, *Journal of Finance*](https://onlinelibrary.wiley.com/doi/full/10.1111/jofi.13404) · [Boston College summary](https://www.bc.edu/bc-web/sites/bc-news/articles/2025/spring/study-shows-text-message-alerts-significantly-reduce-overdrafts.html) · [FCA Occasional Paper 40](https://www.fca.org.uk/publications/occasional-papers/occasional-paper-no-40-time-act-field-experiment-overdraft-alerts) · [FinCap evaluation](https://www.fincap.org.uk/en/evaluations/a-field-experiment-on-overdraft-alerts)

**Self-tracking burden and abandonment**
- [Epstein dissertation (burden ↔ abandonment)](https://digital.lib.washington.edu/researchworks/bitstreams/c791fe4c-ebc3-4708-b5c6-ae111d5a0dde/download) · [Lived informatics model (2015)](https://www.semanticscholar.org/paper/A-lived-informatics-model-of-personal-informatics-Epstein-Ping/95a186d42b161c401ffc7d9ce47167e2510abb04) · [Reconsidering the device in the drawer (UbiComp 2016)](https://doi.org/10.1145/2971648.2971656) · [Clark et al. 2024, myth of discontinuance](https://journals.sagepub.com/doi/abs/10.1177/14614448221083992)
- [Choe et al., SleepTight (UbiComp 2015)](http://faculty.washington.edu/jkientz/papers/Choe-SleepTight-UbiComp2015.pdf) · [OmniTrack (IMWUT 2017)](https://terpconnect.umd.edu/~choe/download/IMWUT-2017-Kim-OmniTrack.pdf) · [semi-automated tracking project](https://info.umd.edu/projects/advancing-personal-informatics-through-semi-automated-tracking/)
- [Kaye et al., Money Talks (CHI 2014)](https://dl.acm.org/doi/10.1145/2556288.2556975) · [PDF](https://rebeccagulotta.com/info/Money-Talks-Tracking-Personal-Finances.-Kaye-et-al-Proc-CHI-20161.pdf) · [Lewis & Perry, Follow the Money (CHI 2019)](https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300620) · [Brunel full text](https://bura.brunel.ac.uk/bitstream/2438/17291/1/FullText.pdf)
- [家計簿が続かない理由（41fp）](https://41fp.com/money_media/lifestyle/kakeibogatutukanaihito/) · [tfp-group](https://tfp-group.co.jp/media/domestic-accounts-book-not-continue/) · [note: 7割が挫折する仕組み](https://note.com/sss3yai/n/n54ff5c6fad06) · [OCR訂正の手間](https://hokkaidougurashi.com/budget-app-stick-with-it/)

**Subscriptions**
- [Einav, Klopack & Mahoney, Selling Subscriptions — FTC-hosted PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/klopackeinavmahoney.pdf) · [Stanford copy](https://nmahoney.people.stanford.edu/sites/g/files/sbiybj23976/files/media/file/subscriptions.pdf) · [SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4539925) · [Strulov-Shlain discussion](https://www.ftc.gov/system/files/ftc_gov/pdf/strulov-shlain_susbscriptions_discussion_ftc16.pdf)
- [C+R Research via CNBC (2022)](https://www.cnbc.com/2022/06/02/consumers-spend-133-more-monthly-on-subscriptions-than-they-realize.html) · [CNBC follow-up](https://www.cnbc.com/2022/09/06/consumers-underestimate-monthly-subscription-costs-by-at-least-100.html)
- [Gourville (1998), Pennies-a-Day, *JCR*](https://econpapers.repec.org/RePEc:oup:jconrs:v:24:y:1998:i:4:p:395-408) · [Bambauer-Sachse & Grewal (2011)](https://www.dhruvgrewal.com/wp-content/uploads/2014/09/2011-JR-Temporal-Prices.pdf) · [aggregation moderators](https://link.springer.com/article/10.1023/A:1025467002310)
- Habituation: [fMRI, polymorphic warnings](https://scholarsarchive.byu.edu/facpub/9306/) · [longitudinal fMRI](https://scholarsarchive.byu.edu/facpub/9293/) · [Tuning Out Security Warnings (fMRI + eye tracking + field)](https://www.researchgate.net/publication/325361021_Tuning_Out_Security_Warnings_A_Longitudinal_Examination_of_Habituation_Through_fMRI_Eye_Tracking_and_Field_Experiments1) · [cursor-tracking replication](https://scholarsarchive.byu.edu/facpub/1955)
- Products: [Rocket Money review (Berger)](https://robberger.com/rocket-money-review/) · [Clark.com](https://clark.com/save-money/rocket-money-review/) · [Fiscify detection limits](https://fiscify.com/blog/rocket-money-subscription-tracker-review/) · [Bobby — MacStories](https://www.macstories.net/reviews/bobby-subscription-tracking-made-easy/) · [Bobby App Store](https://apps.apple.com/us/app/bobby-track-subscriptions/id1059152023) · [サブスク管理アプリ比較（アプリブ）](https://app-liv.jp/lifestyle/finance/3903/) · [サブスクBox 体験記](https://note.com/dreamy_cougar568/n/n2457c1410c89) · [Costly 紹介](https://lomworks.com/blog/best-subscription-management-apps-costly) · [比較記事](https://subsc-select-lab.com/subscription-management-app-recommended/)

**Other**
- [NN/g, Confirmation Dialogs Can Prevent User Errors](https://www.nngroup.com/articles/confirmation-dialog/)
- [Beyond Compliance: A User-Autonomy Framework (arXiv 2506.10324)](https://arxiv.org/abs/2506.10324) — design proposal, no evaluation found
