import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelSelect } from "./ModelSelect";

describe("ModelSelect", () => {
  it("keeps a project-supported model that is absent from global suggestions editable", () => {
    const markup = renderToStaticMarkup(
      <ModelSelect
        value="project-provider/project-model"
        onChange={() => undefined}
      />
    );

    expect(markup).toContain("<input");
    expect(markup).toContain('value="project-provider/project-model"');
    expect(markup).toContain("<datalist");
    expect(markup).not.toContain("<select");
  });
});
