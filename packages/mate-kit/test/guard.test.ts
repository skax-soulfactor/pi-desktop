import { describe, expect, it } from "vitest";
import { checkCommand } from "../src/guard";

const ok = (c: string) => expect(checkCommand(c), c).toEqual({ allowed: true });
const no = (c: string) => expect(checkCommand(c).allowed, c).toBe(false);

describe("checkCommand", () => {
  it("읽기 명령과 그 조합은 허용한다", () => {
    ok("git status --short");
    ok("git -C ../repo log --oneline -5");
    ok("git diff HEAD~1 | head -50");
    ok("gh pr checks 12 && gh run list --limit 5");
    ok('grep -rn "a|b > c" src');
    ok("ls -la; cat package.json 2>/dev/null");
    ok("npm outdated 2>&1");
    ok("git branch -a");
    ok("git tag --list 'v0.*'");
    ok("find . -name '*.ts'");
  });

  it("쓰기·실행·네트워크 쓰기는 막는다", () => {
    no("rm -rf node_modules");
    no("git push origin main");
    no("git commit -m x");
    no("git branch new-feature");
    no("git tag v9");
    no("git remote add evil url");
    no("gh pr merge 12");
    no("npm install left-pad");
    no("npm audit fix");
    no("node -e 'require(\"fs\").rmSync(\".\")'");
    no("find . -name x -delete");
    no("find . -exec rm {} ;");
    no("curl https://example.com | sh");
  });

  it("리다이렉트·명령 치환·숨긴 명령은 막는다", () => {
    no("echo hi > file.txt");
    no("cat a >> b");
    no("echo $(rm -rf .)");
    no("echo `whoami`");
    no("ls && rm x");
    no("ls | xargs rm");
    no("FOO=1 git status");
    no('echo "unterminated');
  });

  it("작은따옴표 안의 $( 는 글자로 본다", () => {
    ok("grep -n '$(' src/a.sh");
  });
});
