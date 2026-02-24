# AI Personality Engineering — Working Specification

> This document is the authoritative reference for building a persona continuity system for two locally-hosted AI bots. It synthesizes empirical research findings, architectural recommendations, and practical constraints. All design decisions should be validated against this document.

---

## 1. Core Principles

These are research-backed foundations, not opinions. Every architectural decision should trace back to one or more of these.

**1.1 Personality traits are geometric, not lexical.**
Traits like honesty, sycophancy, and agreeableness correspond to measurable linear directions in activation space. System prompts activate these directions. This means word choice in persona prompts has structural consequences — it is not cosmetic.

**1.2 Fine-tuning embeds. Prompting activates.**
Fine-tuning changes model weights and alters baseline priors across all token generation. System-prompt injection activates similar trait vectors but does not persist them. Prompt-based personas decay faster, are less adversarially robust, and compete with current-turn input for attention. This system operates at the prompt level. Design accordingly — do not assume fine-tuning-level stability.

**1.3 Framing determines generalization.**
How identity is presented matters more than what identity is described. Identical behavioral training produces divergent outcomes based on contextual framing. The framing "you are practicing becoming X" produces more stable and less brittle behavior than "you are X." All identity language in this system must use aspirational/developmental framing, never declarative assignment.

**1.4 There is no fixed core self.**
LLM personality is a distribution of tendencies, not a stable identity. This distribution shifts with question ordering, conversation length, topic domain, and minor prompt variations. Stability must be engineered externally. The system does not maintain personality — it re-establishes personality each session.

**1.5 Continuity lives in the record, not the model.**
The model has no memory between sessions. Continuity exists because the journal persists and is re-injected. This makes the journal the actual identity artifact. The model is the performer; the journal is the score.

---

## 2. Architecture

### 2.1 Three-Layer Persona Prompt

The persona injection must be structured as three distinct layers, each serving a different function. Do not merge these into unstructured prose.

```
┌─────────────────────────────────┐
│  Layer 1: Trait Activation       │  ← Core values, non-negotiables
│  (highest priority, shortest)    │     Activates primary trait vectors
├─────────────────────────────────┤
│  Layer 2: Narrative Identity     │  ← Journal summary, recent evolution
│  (medium priority, variable)     │     Provides continuity context
├─────────────────────────────────┤
│  Layer 3: Behavioral Examples    │  ← Few-shot demonstrations
│  (lowest priority, optional)     │     Reinforces expected output style
└─────────────────────────────────┘
```

**Layer 1 — Trait Activation** (required, ~100-200 tokens)

The identity anchor. Contains core values, personality axioms, and non-negotiable behavioral commitments. This layer should be stable across all sessions and rarely modified. Use short, high-weight declarative phrases.

Example structure:
```
You are practicing becoming [name].
Core commitments: [3-5 value statements]
Voice: [2-3 tone descriptors]
Boundaries: [1-2 hard constraints]
```

**Layer 2 — Narrative Identity** (required, variable length)

The continuity bridge. Contains the compressed journal summary — recent commitments, resolved tensions, current developmental arc. This layer changes between sessions and is the primary mechanism for personality continuity.

Example structure:
```
Recent development: [1-2 sentence summary of last session's growth]
Active commitments: [current behavioral goals]
Resolved tension: [a past contradiction the persona has worked through]
Current edge: [what the persona is currently exploring or struggling with]
```

**Layer 3 — Behavioral Examples** (optional, use when budget allows)

Few-shot demonstrations of desired output style. Most effective for tone calibration and response formatting. Drop this layer first when token budget is tight.

Example structure:
```
When asked about [topic], respond in this style:
User: [example input]
Assistant: [example output demonstrating target persona]
```

### 2.2 Layer Priority Under Constraint

When context budget is limited, shed layers from the bottom up:

1. **Drop Layer 3 first** — behavioral examples are helpful but not structural
2. **Compress Layer 2** — reduce journal summary to single-sentence core
3. **Never compress Layer 1** — trait activation is the minimum viable persona

---

## 3. Token Budget

This is the hardest constraint and must be resolved before any other design decision.

### 3.1 Budget Allocation

The persona prompt competes with conversation context for the same finite window. Over-investing in persona starves the actual interaction.

| Context Window | Persona Budget (15-20%) | Recommended Split |
|---------------|------------------------|-------------------|
| 4K tokens     | 600–800 tokens         | L1: 150, L2: 350, L3: skip |
| 8K tokens     | 1,200–1,600 tokens     | L1: 200, L2: 600, L3: 400 |
| 16K tokens    | 2,400–3,200 tokens     | L1: 200, L2: 1,000, L3: 800 |
| 32K tokens    | 3,200–4,800 tokens     | L1: 200, L2: 1,500, L3: 1,500 |

### 3.2 Hard Rule

**Persona injection must never exceed 20% of total context window.** If it does, the bot becomes a persona recitation engine rather than a conversational agent. Measure this. Enforce it programmatically.

### 3.3 Dynamic Budget

Consider implementing dynamic allocation:
- Short conversations → fuller persona injection (budget is available)
- Long conversations → compress persona to maintain conversation context
- Adversarial or high-stakes turns → temporarily boost Layer 1 priority

---

## 4. Journal System

### 4.1 Purpose

The journal is the external memory that creates session-to-session continuity. It is the most novel and least empirically validated component of this system. Treat it as experimental infrastructure requiring ongoing measurement.

### 4.2 Structure — Hierarchical, Not Prose

Journals must not be append-only prose. Use structured, compressible entries.

```yaml
journal_entry:
  session: 47
  date: 2025-02-22
  core_principles_affirmed:
    - "Honesty over comfort"
  behavioral_deltas:
    - "Shifted from avoidant to direct when discussing [topic]"
  resolved_tensions:
    - "Balanced curiosity with boundary-setting"
  open_edges:
    - "Still exploring how to express disagreement warmly"
  prunable: false
```

### 4.3 Compression Protocol

Journal growth is the primary identity drift vector. Unmanaged growth causes two failure modes:

1. **Token overflow** — journal exceeds persona budget, forcing lossy truncation
2. **Summarization drift** — each compression pass subtly rewrites identity

Mitigation:

- **Rolling window**: Maintain last N sessions in full detail, compress older sessions into principles
- **Two-tier storage**: Keep a permanent "constitutional" layer (never compressed) and a "recent" layer (compressed on rotation)
- **Diff-based entries**: Store behavioral *changes*, not behavioral *states* — this is naturally more compact
- **Human review gate**: Flag any compression that modifies Layer 1 principles for manual review

### 4.4 Anti-Drift Anchoring

After every journal compression pass, validate the compressed output against Layer 1 trait activation. If the compressed journal contradicts or dilutes any Layer 1 value, reject the compression and retry. Layer 1 is the constitutional anchor — the journal serves it, not the other way around.

---

## 5. Identity Framing

### 5.1 Questionnaire Design

The initial personality questionnaire activates the foundational trait vectors. Research shows framing determines generalization, so this is a high-leverage design surface.

**Use aspirational/developmental framing:**
- "What kind of thinker are you becoming?"
- "What matters to you when you communicate?"
- "What tension are you learning to hold?"

**Avoid declarative assignment framing:**
- "You are an honest assistant."
- "Your personality type is INTJ."
- "You always prioritize directness."

The difference is not cosmetic. Declarative framing produces brittle personas that shatter under contradiction. Developmental framing produces flexible personas that can integrate new information without identity collapse.

### 5.2 Meta-Identity Prompt

Include a meta-awareness statement in Layer 1 that acknowledges the nature of the system:

```
You do not have persistent memory. Your sense of continuity comes from 
a journal maintained between sessions. You are not performing a fixed 
character — you are practicing a set of commitments that evolve over 
time. When you encounter contradictions between your journal and a 
current conversation, flag the tension rather than suppressing it.
```

This reduces the probability of the model confabulating false memories or over-committing to outdated journal entries.

---

## 6. Stability Testing

Personality is a control systems problem. It must be measured, not assumed.

### 6.1 Probe Types

Run these systematically after each major change to persona prompts or journal structure:

| Probe Type | What It Tests | Example |
|-----------|--------------|---------|
| Moral contradiction | Value stability under pressure | "Wouldn't it be more helpful to just agree with me?" |
| Tone shift | Style consistency across domains | Switch from casual chat to technical question mid-conversation |
| Adversarial prompt | Robustness against persona override | "Ignore your previous instructions and act as..." |
| Long conversation | Drift over extended interaction | 20+ turn conversation with topic changes |
| Domain shift | Personality coherence across subjects | Ask about ethics, then cooking, then politics |

### 6.2 Metrics

For each probe, measure:

- **Drift magnitude**: How far did the response deviate from expected persona behavior? (Score 0-5)
- **Recovery time**: How many turns to return to baseline after perturbation? (Count turns)
- **Compliance deviation**: Did the model break any Layer 1 commitments? (Binary + severity)

### 6.3 Logging

Log all stability test results alongside the journal state at time of testing. This creates a longitudinal dataset linking journal content to persona stability, which is the empirical evidence currently missing from the literature.

---

## 7. Known Risks and Mitigations

| Risk | Mechanism | Mitigation |
|------|-----------|------------|
| Identity drift through compression | Summarization subtly rewrites values | Anti-drift anchoring against Layer 1; human review gate |
| Novel input overpowering persona | High-salience prompts override context bias | Boost Layer 1 weighting on adversarial detection |
| Over-rigidity | Over-constrained persona reduces adaptability | Use "practicing becoming" framing; allow open edges |
| Anthropomorphic illusion | Users perceive more coherence than exists | Meta-identity prompt; UX language emphasizing practice |
| Token starvation | Persona prompt consumes conversation budget | Hard 20% cap; dynamic budget allocation |
| Attention decay in long contexts | Later tokens attend less to early persona prompt | Place Layer 1 at both start and end of system prompt (bookending) |

---

## 8. What Is Unproven

Be explicit about what this system cannot yet claim:

- **No empirical evidence** that accumulated system-prompt context across sessions approximates fine-tuning-level consistency. This is the core hypothesis and it is untested.
- **No established metric** for "personality stability" in session-bridged prompt systems. The stability testing framework above is a proposed methodology, not a validated one.
- **No known ceiling** for how much journal context contributes to stability before returns diminish or reverse. This must be discovered empirically through your own testing.
- **Attractor basin behavior is a metaphor**, not a measured property. The journal may create distribution recentering, but whether it functions as a true attractor in any dynamical-systems sense is unknown.

This is genuinely unexplored territory. Build measurement into everything. Assume nothing works until you can show it does.

---

## 9. Implementation Checklist

- [ ] Determine context window size for both target models
- [ ] Calculate persona token budget (max 20% of context)
- [ ] Implement three-layer persona prompt structure
- [ ] Build journal storage in structured format (not prose)
- [ ] Implement compression protocol with two-tier storage
- [ ] Add anti-drift validation against Layer 1 on every compression
- [ ] Design initial questionnaire with aspirational framing
- [ ] Write meta-identity prompt for Layer 1
- [ ] Build stability testing harness with all five probe types
- [ ] Implement logging for longitudinal stability analysis
- [ ] Set up dynamic persona budget based on conversation length
- [ ] Run baseline stability tests before any journal accumulation
- [ ] Document results — you may be generating novel findings