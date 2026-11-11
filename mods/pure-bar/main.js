// pure-bar — the window's own title bar: where you are, and what that is.
//
//   workspace  ·  ⎇ branch  ·  worktree of <repo>  ·  @ machine     [− □ ⨯]
//
// The workspace is the space's name (structural, never ambiguous). The branch
// and the worktree come from the FOCUSED pane, the way WezTerm's tab title
// takes tab.active_pane, tmux's automatic-rename follows the active pane, and
// Sinclair's tab bar tracks the focused pane's working directory. When a tab's
// panes are not all on the same branch (or folder), the bar says how many, so a
// single value is never passed off as the whole truth.
//
// The block holding this mod has window_drag: true, so a press anywhere but
// the buttons moves the window.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, exec, theme, window as win } from "herdr";

export default class PureBar extends View {
  init(_props, cx) {
    this.worktrees = new Map(); // folder -> { repo, linked } | null
    this.asked = new Set();
    this.check(cx);
  }

  // Which repo a folder belongs to, and whether it is a linked worktree.
  // One `git` pair per folder, cached; failures are remembered as "none".
  check(cx) {
    const { focused } = this.where();
    const folder = focused?.cwd;
    if (!folder || this.asked.has(folder)) return;
    this.asked.add(folder);
    const space = spaces().find((s) => s.active);
    const on = space?.machine ?? null;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on }).catch(() => null);
        if (!top || top.code !== 0) return;
        const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on }).catch(() => null);
        const root = top.stdout.trim();
        const gitDir = common && common.code === 0 ? common.stdout.trim() : "";
        const linked = Boolean(gitDir && gitDir !== `${root}/.git`);
        // A linked worktree's repo is the one that owns the shared .git dir.
        const owner = linked && gitDir.endsWith("/.git") ? gitDir.slice(0, -5) : root;
        this.worktrees.set(folder, { repo: owner.split("/").pop(), linked });
      } finally {
        cx.notify();
      }
    });
  }

  where() {
    const space = spaces().find((s) => s.active);
    const tab = space?.tabs.find((t) => t.active);
    const mine = panes().filter((p) => p.tab === tab?.id);
    const focused = mine.find((p) => p.focused) ?? mine[0] ?? null;
    return { space, tab, mine, focused };
  }

  button(t, id, glyph, command, width = 30) {
    return h_flex().id(id).w(width).h_full().flex_none().items_center().justify_center()
      .text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stopPropagation ? cx.stopPropagation() : null; run(command, {}); })
      .child(glyph);
  }

  // What the bar says: the workspace, then the facts about the focused pane.
  // Split out from render() so it can be checked without a window.
  title() {
    const { space, mine, focused } = this.where();
    const branch = focused?.branch ?? space?.branch ?? "";
    const wt = focused?.cwd ? this.worktrees.get(focused.cwd) : null;
    const branches = new Set(mine.map((p) => p.branch).filter(Boolean));
    const folders = new Set(mine.map((p) => p.cwd).filter(Boolean));
    // A tab whose panes disagree says how many, rather than passing one off as all.
    const split = branches.size > 1
      ? `${branches.size} branches`
      : branches.size === 0 && folders.size > 1 ? `${folders.size} folders` : "";
    const facts = [
      branch ? `⎇ ${branch}` : "",
      wt?.linked ? `worktree of ${wt.repo}` : "",
      split,
      space?.machine ? `@ ${space.machine}` : "",
    ].filter(Boolean);
    return { name: space?.name ?? "Herdr", facts };
  }

  render(cx) {
    const t = theme(), w = win();
    this.check(cx);
    const { name, facts } = this.title();
    const mac = w?.platform === "macos";

    return h_flex().id("pure-bar").w_full().h_full().items_center().gap(8).bg(t.background).border_b(1).border_color(t.border)
      .when(mac, (el) => el.pl(84))   // the traffic lights sit there
      .child(div().flex_1().min_w(0).flex().items_center().gap(9).pl(mac ? 0 : 12).overflow_hidden()
        .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(name))
        .when(facts.length > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("·")))
        .children(facts.map((text, i) => div().flex_none().text_size(i === 0 ? 11 : 10.5)
          .text_color(i === 0 ? t.muted : t.dim).child(text))))
      .when(Boolean(w?.buttons), (el) => el
        .child(this.button(t, "bar-min", div().text_size(13).child("−"), "window.minimize"))
        .child(this.button(t, "bar-max", div().text_size(11).child(w.maximized ? "❐" : "□"), "window.maximize"))
        .child(this.button(t, "bar-close", svg("mods/pane/close.svg").size(13), "window.close")));
  }
}
