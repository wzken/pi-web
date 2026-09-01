import { useEffect } from "react";

const keyboardInsetVariable = "--keyboard-inset";

export function useKeyboardInset(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const update = () => {
      if (!viewport) {
        root.style.setProperty(keyboardInsetVariable, "0px");
        return;
      }
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop
      );
      root.style.setProperty(
        keyboardInsetVariable,
        `${Math.round(inset)}px`
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
      root.style.removeProperty(keyboardInsetVariable);
    };
  }, []);
}
