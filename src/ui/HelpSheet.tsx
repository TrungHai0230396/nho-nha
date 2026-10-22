import { HELP } from "../shared/examples";
import { clock, lunarLabel, ruleLabel, whenLabel } from "../shared/describe";
import { parse, type Parsed } from "../shared/parse";
import { Marked } from "./Chips";
import { Sheet } from "./Sheet";

/** What the app makes of a sentence, in the words the list will use for it. */
function understood(p: Parsed, text: string, now: number, offset: number): string {
  let main: string;
  if (p.rule && p.due !== null) main = p.rule.kind === "weekly" ? ruleLabel(p.rule) : `${ruleLabel(p.rule)}, ${clock(p.due, offset)}`;
  else if (p.due !== null) main = `${whenLabel(p.due, now, offset)}${/(?:rằm|mùng|mồng|âm)/iu.test(text) ? ` · ${lunarLabel(p.due, offset)}` : ""}`;
  else if (p.items) main = `danh sách ${p.items.length} món`;
  else main = "chỉ lưu, không nhắc";
  return [main, p.nag && "nhắc dai", ...p.tags.map((t) => `#${t}`)].filter(Boolean).join(" · ");
}

/**
 * More sentences to try than the empty list has room for, by what they
 * show: once, repeating, lunar, and the signs (:, !, #). A tap puts one in
 * the composer, where it can be changed before it is sent.
 */
export function HelpSheet({ now, offset, onClose, onPick }: { now: number; offset: number; onClose(): void; onPick(text: string): void }) {
  return (
    <Sheet title="Gợi ý cách gõ" onClose={onClose}>
      <p className="small" style={{ margin: "4px 0 0" }}>
        Gõ như nhắn tin cho chính mình: app tự hiểu giờ, ngày, lịch lặp lại và ngày âm. Bấm một câu để điền vào ô nhập, sửa lại cho đúng việc của mình rồi gửi. Lười gõ thì bấm micro cạnh nút gửi rồi nói; kể nhiều món thì ngừng một chút giữa các món.
      </p>
      {HELP.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h3>{g.title}</h3>
          <div className="tries">
            {g.items.map((e) => {
              const p = parse(e.text, now, offset);
              return (
                <button key={e.text} className="try ex" onClick={() => onPick(e.text)}>
                  <span>
                    <Marked text={e.text} spans={p.spans} />
                  </span>
                  <span className="ex-got">→ {understood(p, e.text, now, offset)}</span>
                  {e.tip && <span className="ex-tip">{e.tip}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <section aria-label="Sửa cho đúng">
        <h3>Sửa cho đúng</h3>
        <ul className="fixes">
          <li>App hiểu nhầm một chữ là giờ: lúc gõ, bấm vào chữ tô màu đó.</li>
          <li>Gửi rồi mới thấy sai, hay muốn đổi tên, đổi giờ: bấm vào ghi chú → “Sửa”.</li>
          <li>Lịch học nhiều buổi: bấm vào ghi chú → “Sửa” → “Lặp lại”, mỗi buổi chọn ngày và giờ, thêm hay bỏ buổi.</li>
          <li>Danh sách: bấm vào ghi chú, gõ vào ô “Thêm món…”, hay bấm dấu × cạnh món để bỏ.</li>
          <li>Nhắc cả nhà, cả nhóm: Cài đặt → Nhắc chung → Tạo nhóm rồi “Mời người”. Lúc gõ, bấm “Chỉ mình tôi” để đổi sang nhóm; ghi chú có sẵn thì bấm vào nó → “Nhắc chung”.</li>
        </ul>
      </section>
    </Sheet>
  );
}
