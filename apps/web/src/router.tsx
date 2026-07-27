import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode
} from "react";
import { ui } from "./ui";

interface LocationState {
  pathname: string;
  search: string;
}

interface RouterContextValue {
  location: LocationState;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);
const ParamsContext = createContext<Record<string, string>>({});

function browserLocation(): LocationState {
  return {
    pathname: window.location.pathname,
    search: window.location.search
  };
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(browserLocation);
  useEffect(() => {
    const update = () => setLocation(browserLocation());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const navigate = useCallback(
    (to: string, options: { replace?: boolean } = {}) => {
      const target = new URL(to, window.location.href);
      if (target.origin !== window.location.origin) {
        window.location.assign(target.href);
        return;
      }
      const next = `${target.pathname}${target.search}${target.hash}`;
      if (options.replace) window.history.replaceState(null, "", next);
      else window.history.pushState(null, "", next);
      setLocation(browserLocation());
    },
    []
  );
  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}

function useRouter(): RouterContextValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("Router hooks must be used inside BrowserRouter");
  return value;
}

export function useLocation(): LocationState {
  return useRouter().location;
}

export function useNavigate(): RouterContextValue["navigate"] {
  return useRouter().navigate;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
};

export function Link({ to, onClick, children, ...props }: LinkProps) {
  const navigate = useNavigate();
  function activate(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target === "_blank"
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }
  return (
    <a {...props} href={to} onClick={activate}>
      {children}
    </a>
  );
}

export function NavLink({
  to,
  end = false,
  className,
  ...props
}: Omit<LinkProps, "className"> & {
  end?: boolean;
  className?: string | ((state: { isActive: boolean }) => string);
}) {
  const { pathname } = useLocation();
  const active =
    pathname === to || (!end && to !== "/" && pathname.startsWith(`${to}/`));
  const resolvedClass =
    typeof className === "function" ? className({ isActive: active }) : className;
  return <Link {...props} to={to} className={ui(resolvedClass)} />;
}

export interface RouteProps {
  path: string;
  element: ReactNode;
}

export function Route(_props: RouteProps): null {
  return null;
}

export function Routes({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  for (const child of Children.toArray(children)) {
    if (!isValidElement<RouteProps>(child)) continue;
    const match = matchPath(child.props.path, pathname);
    if (match) {
      return (
        <ParamsContext.Provider value={match}>
          {child.props.element}
        </ParamsContext.Provider>
      );
    }
  }
  return null;
}

export function useParams(): Record<string, string> {
  return useContext(ParamsContext);
}

export function Navigate({
  to,
  replace = false
}: {
  to: string;
  replace?: boolean;
}) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace }), [navigate, replace, to]);
  return null;
}

export function useSearchParams(): [
  URLSearchParams,
  (next: URLSearchParams | Record<string, string>) => void
] {
  const { location, navigate } = useRouter();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const setParams = useCallback(
    (next: URLSearchParams | Record<string, string>) => {
      const value =
        next instanceof URLSearchParams
          ? next
          : new URLSearchParams(Object.entries(next));
      const search = value.toString();
      navigate(`${location.pathname}${search ? `?${search}` : ""}`);
    },
    [location.pathname, navigate]
  );
  return [params, setParams];
}

function matchPath(
  pattern: string,
  pathname: string
): Record<string, string> | null {
  if (pattern === "*") return {};
  const patternParts = segments(pattern);
  const pathParts = segments(pathname);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]!;
    const actual = pathParts[index]!;
    if (expected.startsWith(":")) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}
