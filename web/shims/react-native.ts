// Browser stand-in for the single React Native API the shared data layer uses.
// Web tabs never background the way native apps do, so token refresh just stays on.
export const AppState = {
  addEventListener(_type: string, _handler: (state: string) => void) {
    return { remove() {} };
  },
};
