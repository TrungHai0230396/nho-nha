// The sentences the "?" sheet suggests, grouped by what they show the app
// can do. Each is pinned in examples.test.ts to what the app makes of it:
// a suggestion the app then misreads is worse than none.

export interface Example {
  text: string;
  /** What the sentence teaches, for the ones about a sign rather than a time. */
  tip?: string;
}

export const HELP: { title: string; items: Example[] }[] = [
  {
    title: "Nhắc một lần",
    items: [
      { text: "15 phút nữa tắt bếp" },
      { text: "tối nay 9h uống thuốc" },
      { text: "8h sáng mai đi khám răng" },
      { text: "chiều thứ 7 đi siêu thị" },
      { text: "thứ 6 tuần sau nộp báo cáo" },
      { text: "20/11 tặng hoa cô giáo" },
    ],
  },
  {
    title: "Lặp lại",
    items: [
      { text: "mỗi sáng 7h uống thuốc" },
      { text: "9h, 18h hằng ngày uống thuốc" },
      { text: "thứ 2 hằng tuần 19h học bơi" },
      { text: "mỗi thứ 2,4,7 học tiếng Anh, thứ 2 từ 20h đến 20h30, thứ 4,7 từ 20h30 đến 22h" },
      { text: "ngày 5 hằng tháng đóng tiền nhà" },
      { text: "12/5 hằng năm sinh nhật Lan" },
    ],
  },
  {
    title: "Âm lịch",
    items: [{ text: "rằm hằng tháng thắp hương" }, { text: "mùng 1 đi chùa" }, { text: "23/12 âm cúng ông Công ông Táo" }],
  },
  {
    title: "Mẹo",
    items: [
      { text: "đi chợ: trứng, sữa, rau", tip: "Dấu hai chấm rồi kể ra: thành danh sách để tick từng món." },
      { text: "uống thuốc 8h!", tip: "Dấu ! ở cuối: nhắc lại mỗi 10 phút tới khi bấm Xong, nhiều nhất 6 lần." },
      { text: "mai 9h họp #công-việc", tip: "Dấu # để gắn thẻ; bấm vào thẻ để lọc ghi chú." },
      { text: "ý tưởng quà sinh nhật cho mẹ", tip: "Không có giờ thì chỉ lưu lại, không nhắc." },
    ],
  },
];
