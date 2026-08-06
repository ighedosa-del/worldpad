#!/usr/bin/env python3
"""Append the missing closing content to the deriv-guide.html file"""

with open('/home/z/my-project/scripts/deriv-guide.html', 'r') as f:
    content = f.read()

# Find where it was truncated and complete it
truncated_marker = '    <div class='
last_idx = content.rfind(truncated_marker)
if last_idx > 0:
    # Remove the truncated line
    content = content[:last_idx]

# Append the remaining content
remaining = """
    <div class="callout callout-warn">
        <div class="callout-icon">!</div>
        <div class="callout-text"><strong>Keep stakes small while testing.</strong> Start with $0.35 or $1.00 per trade. A Digit Matches contract with 3 ticks typically pays around 7-9x your stake, so a $1 trade returns roughly $7-9 if correct. But the base probability is only 10% for matching a specific digit, so expect many losses. The signal's confidence percentage is your edge estimate, not a guarantee.
        </div>
    </div>

    <!-- CHAPTER 6 -->
    <div class="chapter-header">
        <div class="section-tag">Step 6</div>
        <div class="section-title">Time Your Entry</div>
        <div class="divider"></div>
    </div>

    <div class="body-text">
        Each signal has a <strong>countdown timer</strong> (the green/yellow bar on the card). The pattern the engine detected is freshest at the start of the signal window and decays over time. You want to enter your trade <strong>as early as possible</strong> after a signal appears. The card shows how many seconds are left before the signal expires and a new analysis runs.
    </div>

    <div class="callout callout-danger">
        <div class="callout-icon">X</div>
        <div class="callout-text"><strong>Do not enter if less than 3 seconds remain.</strong> The statistical edge has decayed significantly by then. Wait for the next fresh signal instead. Rushing late entries is the most common mistake and will lose you money faster than random trading.
        </div>
    </div>

    <div class="body-text">
        The <strong>"Enter in X ticks"</strong> field on strong signals tells you the optimal entry point within the signal window. "Enter in 1 tick" means place your trade immediately. "Enter in 2 ticks" means wait one tick (watch one price update), then enter on the second tick. This timing accounts for micro-patterns the engine detects in the most recent data.
    </div>

    <!-- CHAPTER 7 -->
    <div class="chapter-header">
        <div class="section-tag">Step 7</div>
        <div class="section-title">Click Buy and Monitor</div>
        <div class="divider"></div>
    </div>

    <div class="body-text">
        Once everything is set correctly (contract type, digit/barrier, duration in ticks, stake amount), click the <strong>"Buy Contract"</strong> button on Deriv. The contract opens immediately and Deriv starts monitoring ticks. You will see a live countdown showing how many ticks remain. The contract resolves automatically when the tick count reaches zero.
    </div>

    <div class="body-text">
        While the contract is active, <strong>do not close it manually</strong>. Let it run to completion. The outcome depends on the final tick's last digit (for digit contracts) or the final tick direction (for Rise/Fall). Deriv shows the result instantly: you either win the payout or lose the stake. There is no partial win or early exit for tick-based contracts.
    </div>

    <div class="body-text">
        After the contract settles, check the result against what Signal Vision predicted. Over time, the <strong>trust badge</strong> at the bottom of each signal card will update with your real accuracy: showing how many predictions were correct out of the total. If the badge turns red and says "Accuracy below random," stop trading that particular symbol or contract type until the patterns improve.
    </div>

    <!-- CHAPTER 8 -->
    <div class="chapter-header">
        <div class="section-tag">Step 8</div>
        <div class="section-title">Risk Management Rules</div>
        <div class="divider"></div>
    </div>

    <div class="step-card">
        <div class="step-header">
            <div class="step-num">$</div>
            <div class="step-title">Maximum $1-2 Per Trade While Testing</div>
        </div>
        <div class="step-desc">
            While you are learning and verifying the signal accuracy, never risk more than $1-2 per trade. Even if a signal shows 75% confidence, that is an estimate based on statistical patterns, not a guarantee. Synthetic indices are pseudo-random number generators, and patterns can shift without warning. Small stakes mean a losing streak will not wipe out your account.
        </div>
    </div>

    <div class="step-card">
        <div class="step-header">
            <div class="step-num">5</div>
            <div class="step-title">Stop After 5 Losses Per Session</div>
        </div>
        <div class="step-desc">
            Set a hard daily loss limit. If you lose 5 trades in a row, close the platform and walk away. Losing streaks happen with any system, and chasing losses by increasing your stake is the fastest path to blowing your account. Come back later when the market patterns may have shifted.
        </div>
    </div>

    <div class="step-card">
        <div class="step-header">
            <div class="step-num">&#9733;</div>
            <div class="step-title">Only Trade Strong Signals (72%+)</div>
        </div>
        <div class="step-desc">
            The Signal Vision dashboard shows three strength levels: Strong (72%+ confidence, green border), Moderate (62-71%, yellow), and Weak (below 62%, shown as WAIT). While testing, only trade Strong signals. These have the highest statistical edge and the best backtest validation. Moderate signals can be profitable but require more discipline and smaller stakes.
        </div>
    </div>

    <div class="step-card">
        <div class="step-header">
            <div class="step-num">&#10003;</div>
            <div class="step-title">Check the Trust Badge Before Every Trade</div>
        </div>
        <div class="step-desc">
            Each card's trust badge shows live accuracy tracked from real predictions. If it says "Live: 3/20 (15%)" for a Matches signal, that means only 3 out of 20 predictions were correct. For digit matching, random chance is 10%, so 15% is only marginally better. If the badge turns red with "Accuracy below random," do not trade that symbol until accuracy improves.
        </div>
    </div>

    <div class="callout callout-danger">
        <div class="callout-icon">!</div>
        <div class="callout-text"><strong>Never invest money you cannot afford to lose.</strong> Synthetic indices are designed for entertainment and speculation. There is no guaranteed winning strategy. The prediction engine detects short-term statistical patterns in pseudo-random data, but these patterns are not reliable enough to serve as a primary income source. Treat this as a learning tool, not a money-making system.
        </div>
    </div>

    <!-- CHAPTER 9 -->
    <div class="chapter-header">
        <div class="section-tag">Quick Reference</div>
        <div class="section-title">Complete Signal-to-Trade Workflow</div>
        <div class="divider"></div>
    </div>

    <div class="step-card">
        <div class="step-header">
            <div class="step-num">1</div>
            <div class="step-title">Open Signal Vision and wait for LIVE status</div>
        </div>
        <div class="step-desc">The green LIVE badge in the header means data is streaming. Wait 15-30 seconds after loading for tick data to accumulate.
        </div>
    </div>
    <div class="arrow-connector">&#8595;</div>
    <div class="step-card">
        <div class="step-header">
            <div class="step-num">2</div>
            <div class="step-title">Find a TRADE NOW card with 72%+ confidence</div>
        </div>
        <div class="step-desc">Look for the green TRADE NOW pill, Strong label, and a confidence ring at 72% or higher. Check the trust badge shows decent accuracy.
        </div>
    </div>
    <div class="arrow-connector">&#8595;</div>
    <div class="step-card">
        <div class="step-header">
            <div class="step-num">3</div>
            <div class="step-title">Note the symbol, prediction, and duration</div>
        </div>
        <div class="step-desc">Write down: which index (e.g., Volatility 25), what the signal says (e.g., MATCH 7), how many ticks (3 or 5), and seconds remaining.
        </div>
    </div>
    <div class="arrow-connector">&#8595;</div>
    <div class="step-card">
        <div class="step-header">
            <div class="step-num">4</div>
            <div class="step-title">Open Deriv, select the matching index and contract</div>
        </div>
        <div class="step-desc">On deriv.com, go to Synthetic Indices, click the same volatility index, pick the correct contract type, set the digit/barrier, and set duration to Ticks.
        </div>
    </div>
    <div class="arrow-connector">&#8595;</div>
    <div class="step-card">
        <div class="step-header">
            <div class="step-num">5</div>
            <div class="step-title">Set stake to $1, check seconds left, click Buy</div>
        </div>
        <div class="step-desc">Only enter if the signal has 5+ seconds remaining. Click Buy Contract and let it run to completion. Record the result.
        </div>
    </div>
    <div class="arrow-connector">&#8595;</div>
    <div class="step-card">
        <div class="step-header">
            <div class="step-num">6</div>
            <div class="step-title">Wait for the next signal, track your results</div>
        </div>
        <div class="step-desc">After each trade, the trust badge updates. After 20+ trades, you will have a real accuracy number. Use this to decide whether to continue or adjust.
        </div>
    </div>

</div>

<!-- ENDING -->
<div class="ending">
    <div class="ending-big">Start Small. Stay Disciplined.</div>
    <p class="ending-sub">Use the demo account first. Track every trade. Only increase stakes after 50+ trades show consistent accuracy above random chance. This tool analyzes patterns, but no system can predict pseudo-random numbers with certainty.</p>
</div>

</body>
</html>
"""

content += remaining

with open('/home/z/my-project/scripts/deriv-guide.html', 'w') as f:
    f.write(content)

print('HTML guide completed successfully!')
