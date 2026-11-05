// Gas limit for wallet transactions. Hedera relays answer eth_estimateGas at the edge: a limit equal to the estimate ran
// out of gas inside ATS (spike S1 revokeKyc; step 9 investor B redeem through this dashboard: INSUFFICIENT_GAS at
// 304,741 of 311,684). The scripts and the oracle send estimate × 1.3; Hedera charges the gas used, so the buffer is free.
const NUM = 13n;
const DEN = 10n;

export const gasLimitFor = (estimate: bigint): bigint => (estimate * NUM + DEN - 1n) / DEN;
