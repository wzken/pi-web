import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { ui } from "../../../ui";

export function Markdown({ children }: { children: string }) {
  return (
    <div className={ui("markdown")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          a: ({ node: _node, children: content, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {content}
            </a>
          ),
          code: ({ node: _node, className, children: code, ...props }) => (
            <code className={ui(className)} {...props}>
              {code}
            </code>
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
