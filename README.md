# Adaptive Micro-Action Trigger Engine

A context-aware timing optimization prototype that adapts micro-action prompts based on user feedback, health constraints, and response patterns.


## Live Demo

[Open the live app](https://05-adaptive-micro-action-trigger-en.vercel.app/)

A context-aware timing optimization prototype that adapts micro-action prompts based on user feedback, health constraints, and response patterns.

## Overview

This project is a React-based digital health prototype that demonstrates an adaptive timing engine for low-burden health behavior prompts.

The core idea is:

> The intervention content is pre-written and controlled. The algorithm personalizes when to deliver the prompt.

Rather than generating new health advice, this prototype focuses on learning when a user may be most likely to respond to a two-minute movement prompt.

## Why I Built This

Many digital health tools know what behavior to recommend, but not when to prompt the user.

A person may ignore a health behavior reminder not because the recommendation is wrong, but because the timing does not fit their context, fatigue, pain, routine, or availability.

This project explores how a simple adaptive algorithm can personalize prompt timing based on user feedback such as:

- Did it
- Partially did it
- Skip
- Later
- Too tired
- Pain/discomfort

## Product Concept

This project is an early prototype of an **Adaptive Prompt Timing Engine**.

The long-term product idea is to help digital health apps deliver prompts at the moment each user is most likely to act.

Possible use cases include:

- walking interventions
- chronic disease self-management
- physical activity support
- wellness coaching
- remote patient engagement
- digital health engagement optimization

## Key Features

- User profile setup
- Daily context input
- Context-aware trigger timing recommendation
- Transparent adaptive scoring logic
- Pre-written micro-action prompts
- Safety-aware note
- Explanation of why a time window was selected
- Feedback buttons
- Timing score updates
- Feedback history
- Personalization dashboard
- localStorage-based demo persistence
- Reset demo data function

## Inputs

The prototype uses two types of inputs.

### User Profile

- preferred time windows
- main barrier
- baseline confidence
- preferred prompt frequency
- pain concern

### Daily Context

- fatigue today
- pain today
- motivation today
- weather
- availability today

## Outputs

The engine recommends:

- a time window for the next micro-action prompt
- a pre-written two-minute movement prompt
- a safety-aware note
- an explanation of why the time window was selected
- a score snapshot showing how the decision was made

## Adaptive Timing Logic

The prototype uses transparent adaptive scoring logic.

Each time window starts with a default score.

The current version includes four candidate time windows:

- morning
- afternoon
- evening
- after dinner

The algorithm updates timing scores based on feedback.

Examples:

- Did it → selected time window score increases
- Partially did it → selected time window score slightly increases
- Skip → selected time window score decreases
- Later → selected time window score slightly decreases, later time window increases
- Too tired → selected time window score decreases
- Pain/discomfort → selected time window score decreases and safety mode is activated

## Safety-First Design

This prototype does not generate medical advice.

The micro-action content is pre-written and controlled. The algorithm only personalizes timing.

The prototype includes safety-aware logic such as:

- high pain activates a safety mode note
- high fatigue reduces the score for more demanding time windows
- pain/discomfort feedback lowers the score for the selected time window
- the system prioritizes low-burden two-minute movement prompts

## Why Timing Matters

The project is based on the idea that behavior change support should consider not only what to recommend, but also when to recommend it.

A reminder sent at the wrong time may be ignored.  
A prompt sent at a feasible moment may help initiate a small action.

This prototype explores timing personalization as a practical pathway for improving engagement with digital health interventions.

## Research Relevance

This project connects to my broader interests in:

- digital health
- healthcare AI
- behavior change
- chronic disease self-management
- just-in-time adaptive interventions
- adaptive intervention design
- responsible AI in health
- personalized prompt timing
- implementation science
- human-centered health technology

The central research question is:

> Can user feedback and daily context be used to adaptively personalize the timing of low-burden health behavior prompts?

## Product Relevance

This prototype also explores a potential product direction:

> An adaptive prompt timing engine that can be integrated into digital health apps to improve user response and behavior initiation.

Rather than building another reminder app, the long-term goal is to build a reusable optimization layer for digital health engagement.

## Tech Stack

- React
- Vite
- JavaScript
- CSS
- localStorage
- Vercel

## Data Storage

This demo stores data locally in the browser using localStorage.

Stored data include:

- user profile
- daily context
- timing scores
- feedback history
- last recommendation

This version does not collect real patient data, personal health information, or identifiable information.

## Disclaimer

This prototype supports behavior change timing personalization and is not medical advice.

Users with pain, medical conditions, or safety concerns should consult a qualified healthcare professional before changing their physical activity routine.

## Future Improvements

Future versions could include:

- CSV export of feedback history
- simulated user testing
- PWA support
- push notification support
- backend database storage
- comparison of fixed timing vs adaptive timing
- contextual bandit algorithm
- integration with wearable data
- integration with digital health coaching platforms
- pilot testing with users managing chronic conditions

## How to Run This Project Locally

1. Clone this repository.

```bash
git clone https://github.com/Yeongseo-Lee/adaptive-micro-action-trigger-engine.git
```

2. Move into the project folder.

```bash
cd adaptive-micro-action-trigger-engine
```

3. Install dependencies.

```bash
npm install
```

4. Start the development server.

```bash
npm run dev
```

5. Open the local URL shown in the terminal. It is usually:

```bash
http://localhost:5173/
```

## Status

This is an early-stage adaptive timing optimization prototype for digital health behavior prompts.