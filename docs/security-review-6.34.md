# Security review for 6.34

Review date: 2026-11-25. Scope: all 31 historical CodeQL alerts, including the
17 production locations listed below, their release-candidate implementations
and relevant downstream uses. The remaining 14 locations were checked against
the actual remote main source. This is a source and disposition review, not a
penetration test or a new CodeQL scan. Unless explicitly marked as remote main,
fix descriptions refer to the unmerged 6.34 release worktree.

## Historical alert status

The initial read-only GitHub API query on the review date returned all 17
production alerts as `dismissed`, with `dismissed_reason: used in tests` and no
individual explanation. That blanket explanation was inaccurate. The release
owner subsequently corrected the remote dispositions; this reviewer did not
modify remote state. The correction history is retained here so that a previous
zero-open count cannot be presented as evidence of 17 implemented fixes.

At `2026-11-25T09:04:39Z`, an independent API read returned these states:

| Scope | Open | Dismissed | Fixed | Explanation |
| --- | ---: | ---: | ---: | --- |
| 17 production locations | 9 | 7 | 1 | Nine reopened for a scan of the integrated fixes; seven individually explained dismissals; one already removed implementation. |
| 14 test/acceptance locations | 0 | 10 | 4 | Ten actual test uses retain that reason; four already have scan-confirmed fixed states. |
| All 31 historical alerts | 9 | 17 | 5 | This is a dated API snapshot, not a zero-alert claim. |

The production corrections were applied as follows:

| Alert(s) | Verified remote state | Actual disposition history |
| --- | --- | --- |
| #1, #14, #16, #21, #22, #23, #25, #26, #27 | `open` | Reopened between `08:51:27Z` and `08:51:42Z`; await main analysis containing the 6.34 changes. |
| #24 | `fixed` | Reopened at `08:51:37Z`; GitHub retained its historical fixed result because `hema.js` was already removed. Its recorded `fixed_at` is `2026-11-23T05:08:57Z`; this is not a new 6.34 scan. |
| #10, #11, #12, #13 | `dismissed`, `won't fix` | Corrected between `08:53:07Z` and `08:53:15Z`, with individual comments explaining required protocol MD5 and the separate credential/update-integrity boundaries. |
| #15, #17, #18 | `dismissed`, `false positive` | Corrected at `08:53:18Z`, `08:53:21Z` and `09:04:06Z`, respectively, with comments explaining URL decoding and the relevant consumers/guards. |

All correction times above are UTC on 2026-11-25. None of the 17 production
locations still used the test-only reason in this snapshot. Dismissal is a
reviewed disposition, not a claim that the underlying MD5 or decoding code was
removed. Historical line numbers have shifted, so the following table identifies
release-candidate functions rather than old line numbers.

| Alert(s) | Rule / production location | Current review conclusion |
| --- | --- | --- |
| #1 | `js/identity-replacement`; `main.js`, diagnostic export filename | The internally generated timestamp had a redundant `replace(/Z$/, 'Z')`. It did not provide a demonstrated attack path. The release integration removed the redundant replacement. |
| #10, #11, #12, #13 | `js/weak-cryptographic-algorithm`; `app-source.js`, request-signing helpers | MD5 remains part of existing upstream protocol encoding: request query/body digests, signature branch selection and Helios input. It is not used here as a password verifier, credential-storage encryption or a standalone local integrity boundary. Retain only for protocol compatibility, not as a claim that MD5 is secure. |
| #14, #22 | `js/double-escaping`, `js/incomplete-multi-character-sanitization`; `account-session.js`, `cleanText` | This helper normalizes profile nicknames and history titles. It can leave or reintroduce markup-like text and is not an HTML sanitizer. Current reviewed outputs use ordinary React text/attributes; no executable HTML sink was identified. |
| #15 | `js/double-escaping`; `app-source.js`, `cleanUrl` | This decodes transport escapes in media URLs. Parsed App media must pass `checkedUrl`: HTTPS, no credentials, default HTTPS port and an explicit media-domain suffix allowlist. This is URL decoding, not HTML sanitization. |
| #16, #25 | `js/double-escaping`, `js/incomplete-multi-character-sanitization`; `hongguo-app-search.js`, `cleanTitle` | Same text-normalization limitation as #14/#22. Search results flow to ordinary React text/attributes. Do not reuse this helper to construct HTML. |
| #17 | `js/double-escaping`; `hongguo-search.js`, `cleanUrl` | Decodes escaped URL separators/entities for cover data. `safeCover` accepts anchored HTTP(S) URLs, which become image sources rather than executable markup. This does not establish a public-DNS or general SSRF guarantee for images. |
| #18 | `js/double-escaping`; `hongguo.js`, `normalizeVideoUrl` | Decodes escaped media URL characters and removes the legacy Range query parameter. The reviewed website playback path parses the result as a URL, binds it to the requested episode/player and applies `isPublicMediaUrl` before native media transport. No HTML execution sink was identified. |
| #21 | `js/bad-tag-filter`; `hongguo.js`, JSON-LD script extraction | The sequential script-block scanner extracts JSON-LD for `JSON.parse`; it does not remove scripts before executing/rendering an HTML document. Candidate media must match the current episode and pass URL checks. Malformed HTML can defeat extraction, so this remains a parser reliability limitation, not a general HTML-filter security boundary. Repeated unclosed script openings no longer repeatedly scan the same suffix. |
| #23 | `js/incomplete-multi-character-sanitization`; `custom-source.js`, `plainText` | Normalizes source names, titles, introductions and tags for ordinary React text/attributes. It is not an HTML sanitizer. Source/media URLs have separate URL validation and guarded native requests. No executable HTML sink was identified for these strings. |
| #24 | `js/incomplete-multi-character-sanitization`; former `hema.js` | The implementation is absent from the current tree. The package explicitly excludes the old file, and active entry points reject `hema:` tasks. This is removed production code, not test-only code. |
| #26 | `js/incomplete-multi-character-sanitization`; `nas-export.js` | NAS NFO ownership is now established using an XML parser and exact root-level identity elements. Description text, escaped tags, comments and CDATA cannot impersonate ownership. Output uses XML escaping at the XML sink. See the fix details below. |
| #27 | `js/incomplete-multi-character-sanitization`; `xifan.js`, `plainText` | Normalizes catalog and episode display strings used as ordinary React text/attributes. Media URLs are separately required to be HTTPS without embedded credentials before downstream media handling. The display-text helper is not an HTML sanitizer. |

The table accounts for all 17 alert numbers. The review identified the NAS
ownership defect and excessive synchronous parsing work on malformed remote
text; both fixes are described below. No additional exploitable path was
demonstrated by this targeted review. That conclusion is specific to the
reviewed consumers; it does not make the normalization helpers safe for future
HTML sinks.

## Main source and scan baseline

At the same verification, remote main was
`d7ea27edfe72a1fa4f84072bbbf5c650a0d0f62f` (6.33 release receipt).
The latest successful main CodeQL analysis was `2245628783`, created at
`2026-11-25T06:30:04Z` for
`b52a6943e135f8a6bacf2250fdbe9f145019e6e5`, category
`.github/workflows/codeql.yml:javascript`, with 26 results, 87 rules and empty
error/warning fields. Between these two commits only `README.md`,
`docs/maintenance.md` and `docs/release-6.33.md` changed; their production paths
are identical. The 6.34 candidate fixes were not yet in either main commit.

Inspection of that exact main source confirmed that `main.js:2214` still had
the redundant timestamp replacement, `nas-export.js:154` still used the old
comment-removal/identity regex, and the account/search/custom-source/Xifan
display helpers and website JSON-LD extraction still used their old regexes.
`src/native/hema.js` was absent, its old package exclusion remained, and active
`hema:` task routes rejected that removed source. Thus the nine open production
states were consistent with the scanned main baseline; local regression success
alone cannot change them to scan-confirmed fixes.

The recorded PR analysis for `refs/pull/46/merge` had zero results, but that is a
different ref and analysis from main. It does not clear the 26 main results or
validate unmerged 6.34 source. Main push/PR scans use the existing CodeQL workflow;
the integration owner must inspect a successful main analysis at the actual
merged commit before recording the remaining outcomes.

## Test-only dispositions

The other 10 `used in tests` dismissals were verified against remote main
`d7ea27edfe72a1fa4f84072bbbf5c650a0d0f62f`, including the flagged lines and their
callers. They are actual test or installation-acceptance programs:

| Alert(s) | Main location | Verified use |
| --- | --- | --- |
| #2 | `scripts/check-download-manager.cjs:49` | Optional CLI regex filters local test names in the download-manager harness. It is intentionally a developer-supplied regex, not application search input. |
| #3 | `scripts/check-series-search.cjs:15` | The same CLI test-name filter in focused offline series-search checks. |
| #4 | `src/components/check-ui-state.cjs:125` | CLI test-name filtering in the mocked UI-state runner. `scripts/test.cjs` launches it; application components do not import it. |
| #5 | `scripts/check-windows-installer.cjs:120` | A CDP message ID selects a callback from a `Map` belonging to an isolated installer acceptance session. It is not a dynamic property/method name exposed by application IPC. |
| #6, #7 | `scripts/check-source-retry.cjs:133`, `:194` | Fixed local fault objects are serialized into an isolated VM harness to simulate unrecoverable/temporary transfers. These objects are not server or renderer input. |
| #8 | `scripts/check-floating-player-window.cjs:151` | `trustedChecks` is an array of observed validation calls; `.includes` asserts exact array membership. It is not a substring-based URL authorization check. |
| #9 | `scripts/check-share-security.cjs:123` | A synthetic Axios response chooses its fixture shape by the requested sample URL. The production share/DNS validation is exercised separately; this branch grants no production access. |
| #19 | `scripts/check-app-update-installer.cjs:145` | A regex assertion checks `latest.yml` against the locally versioned package version. It is not escaping arbitrary remote text for application execution. |
| #20 | `scripts/fixtures/hongguo-video.cjs:45` | The test-media downloader extracts inert JSON-LD and parses JSON. It is a network-backed test fixture, not an HTML sanitizer or a packaged playback implementation. |

Electron Builder's explicit `build.files` list omits `scripts/**` and copies
compiled `dist-react/**` rather than the raw `src/components` directory. The UI
test runner has no application import; its only execution entry found is the
test launcher. Other references to the listed helpers are test scripts or the
Windows candidate workflow. These observations support the test-only reason;
they do not imply that arbitrary test inputs are safe or that tests cannot
access the network or install an application.

The remaining four alerts, #28-#30 in `scripts/check-ui-theme.cjs` and #31 in
`scripts/check-backend-lifecycle.cjs`, already had `fixed` API states. Their
current main programs use fixed renderer actions/selectors and a direct VM
context assignment for the fixture root rather than the former dynamic code
interpolation. They are not part of the 10 retained test dismissals and were
not reopened or re-dismissed by this review.

## Pending scan decisions

- Verify #1 and #26 against a main analysis containing their actual source
  changes. The NAS ownership defect has a real file-conflict safety impact and
  must not be dismissed merely because a local test passes.
- #22, #23, #25 and #27 no longer use the old stripping regex in the candidate.
  Confirm the new scan result; if an alert relocates to a shared helper, inspect
  its actual data consumers rather than assuming a moved line is a fix.
- #14 and #16 may remain because the candidate intentionally retains entity
  decoding and its output contract. If the same rule persists and all reviewed
  consumers remain ordinary React text/attributes or properly encoded XML,
  `false positive` with a production data-flow explanation is appropriate.
  Recheck any newly introduced HTML sink before making that disposition.
- #21 may disappear at its old line and reappear on `html-script-blocks.js`.
  The official `BadTagFilter.ql` directly selects an HTML-matching regex whose
  opening/closing-tag handling is incomplete; it does not require an executable
  HTML sink. The scanner intentionally preserves inert JSON-LD extraction
  semantics and still uses a restricted closing-tag regex. A repeat of this
  specific security claim can be a documented `false positive` after verifying
  `JSON.parse`, episode binding and URL checks at the new location. It remains
  an extraction reliability limitation, not a general HTML sanitizer.
- Newly reported paths or rules require their own review. Do not bulk-dismiss
  new results or change protocol/display behavior solely to lower the alert
  count.

The repeat-alert expectations above are source-based predictions, not results
from a new scan. Rule semantics were checked against the official
[CodeQL query help](https://codeql.github.com/codeql-query-help/javascript/js-bad-tag-filter/)
and
[BadTagFilter.ql source](https://github.com/github/codeql/blob/main/javascript/ql/src/Security/CWE-116/BadTagFilter.ql).

## Credential and protocol boundaries

`signedSearchRequest` uses an anonymous device identity and `user_is_login=0`.
Metadata requests use a process-local anonymous identity. Account history signs
its request from device/request parameters, then `account-session.js` attaches
the Cookie only for the exact existing official history origin and path.

The separate, explicitly invoked App authentication comparison also attaches its
Cookie after signing and restricts the request to the official preload origins,
exact endpoint, POST method and a buffer body. The ordinary App source resolver
does not consume the website Cookie. This review does not establish whether a
website Cookie grants App playback authorization; live A/B evidence belongs in
the playback acceptance record.

Account persistence uses Electron `safeStorage.encryptString` and
`decryptString`. Saving/loading refuses unavailable encryption and the
`basic_text` backend. The protocol MD5 helpers do not implement this storage.
Changing a protocol digest unilaterally would change request bytes; stronger
password/storage cryptography is a separate concern from upstream compatibility.

## NAS ownership fix

`hasHongguoIdentity` parses XML with `@xmldom/xmldom`, rejects parser diagnostics,
DOCTYPEs and invalid or namespaced roots, and requires exactly one matching
root-level, unnamespaced `uniqueid` element with the `hongguo` type and exact identity. Nested
markup cannot serve as an identity value. Existing valid legacy episode NFOs
remain readable. Files that fail ownership checks remain conflicts and must not
be overwritten as if they belonged to the requested drama.

`xml` removes invalid XML control characters and escapes `&`, `<`, `>`, `"` and
`'` when producing title, description and identity elements. The NAS regression
run accompanying the fix was reported by release integration as 32/32 passing;
this source review inspected its ownership fixtures rather than rerunning that
suite. Those fixtures include description/comment/CDATA spoofing, malformed XML,
duplicate/nested identities, a lookalike type attribute and external declarations.

## Malformed text parsing fix

The former `/<[^>]*>/g` display normalization retries from every unmatched `<`
when no closing `>` exists, causing quadratic work in the Electron main process.
`stripMarkupText` now advances through complete spans once and preserves an
unmatched suffix without rescanning it. Account profile/history, App search,
catalog ranking, custom-source and Xifan text normalization share this helper.
Entity-decoding order, empty or nested tag handling and each caller's existing
whitespace behavior remain unchanged. This is still display-text normalization;
HTML and XML consumers must encode text at their output sinks.

The website JSON-LD extractor similarly uses `readScriptBlocks` to advance
through opening and closing tags without retrying a missing closing tag for
every later opening. It retains the previous extraction and `JSON.parse`
behavior, including case-insensitive tags and inert script contents.

The regression runs multi-megabyte unmatched `<` input, closed-plus-unclosed
input and repeated unclosed script openings in a separate process with a
five-second timeout. It checks output equality rather than treating completion
alone as success. Sampled legacy regex outputs and account/App entity decoding
are also checked. The focused account and parsing run passed 70/70 tests; the
catalog, ranking and Xifan checks passed separately. These bounded tests do not
claim that all HTML parsing in the application has been replaced or audited for
all possible malformed inputs.

## Verification and limits

- Queried all 31 historical alerts and the main analysis metadata through the
  GitHub code-scanning API without modifying remote state. The final disposition
  snapshot for this review is `2026-11-25T09:04:39Z`; later integration/scan results
  must be recorded separately.
- Traced the listed production helpers to account, search, browse, feed, player,
  NAS XML, casting XML and JSON text-export consumers. The reviewed JSX consumers
  use text children/attributes; casting and NAS XML encode text at their sinks.
- Searched `src`, `main.js` and `preload.js` for `dangerouslySetInnerHTML`,
  `insertAdjacentHTML`, `document.write`, `innerHTML` assignment, `eval` and
  `new Function`; no matching dynamic HTML/evaluation sink was found. The
  `document.documentElement.innerHTML` occurrence reads page HTML for extraction.
- Inspected App URL/redirect guards and the native website-media guard. The
  latter checks direct socket DNS resolution and redirect destinations; an
  explicitly selected proxy's remote DNS remains a trust boundary. These checks
  must not be generalized to every renderer image request.
- No account profile, Cookie store or live account process was accessed for this
  audit. No credentials, signatures, device identifiers or signed media URLs are
  included in this report.
- No new CodeQL run, complete adversarial HTML parser evaluation, external
  penetration test or real-media playback result is claimed here. Release-wide
  unit, packaging and live playback validation are recorded separately.
