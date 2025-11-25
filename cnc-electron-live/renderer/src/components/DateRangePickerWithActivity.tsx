import React, { useEffect, useRef, useState } from "react";
import flatpickr from "flatpickr";
import "flatpickr/dist/flatpickr.css";
import { Polish } from "flatpickr/dist/l10n/pl.js";
import "../styles/calendar-activity.css";

type ActivityDay = {
  workSec: number;
  idleSec: number;
  emergencySec: number;
  programs: number;
};

type Props = {
  from: string; // ISO-like: "YYYY-MM-DDTHH:mm"
  to: string;   // ISO-like: "YYYY-MM-DDTHH:mm"
  onChange: (nextFromIso: string, nextToIso: string) => void;
  className?: string;
};

const DateRangePickerWithActivity: React.FC<Props> = ({ from, to, onChange, className }) => {
  const fromRef = useRef<HTMLInputElement | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);
  const fpFrom = useRef<flatpickr.Instance | null>(null);
  const fpTo = useRef<flatpickr.Instance | null>(null);

  const [calendarActivity, setCalendarActivity] = useState<Record<string, ActivityDay>>({});

  const fmt = (d: Date) => {
    const p = (n: number) => (n < 10 ? "0" + n : "" + n);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const monthRangeOf = (d: Date) => {
    const first = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return { first, last };
  };

  async function fetchMonthActivity(anchor: Date) {
    const { first, last } = monthRangeOf(anchor);
    const fromIso = new Date(first.getTime() - 7 * 86400000).toISOString();
    const toIso = new Date(last.getTime() + 7 * 86400000).toISOString();
    const stats = await (window as any).api.getStats(fromIso, toIso);

    const map: Record<string, ActivityDay> = {};
    for (const d of stats.byDay) {
      map[d.day] = {
        workSec: d.workSec,
        idleSec: d.idleSec,
        emergencySec: d.emergencySec,
        programs: d.programs,
      };
    }
    setCalendarActivity(map);
    fpFrom.current?.redraw();
    fpTo.current?.redraw();
  }

  function decorateDay(elem: HTMLElement, date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${d}`;
    const a = calendarActivity[key];

    elem.classList.remove("day-has-emergency", "day-has-work", "day-idle-only", "day-no-data");

    if (!a) {
      elem.classList.add("day-no-data");
      elem.removeAttribute("title");
      return;
    }

    const hms = (s: number) => {
      const ss = Math.max(0, Math.floor(s || 0));
      const hh = Math.floor(ss / 3600);
      const mm = Math.floor((ss % 3600) / 60);
      const sss = ss % 60;
      const p = (n: number) => (n < 10 ? "0" + n : "" + n);
      return `${p(hh)}:${p(mm)}:${p(sss)}`;
    };

    let title = `Praca: ${hms(a.workSec)}\nPostój: ${hms(a.idleSec)}\nAwaria: ${hms(a.emergencySec)}\nProgramy: ${a.programs}`;
    if (a.emergencySec > 0) {
      elem.classList.add("day-has-emergency");
    } else if (a.workSec > 0) {
      elem.classList.add("day-has-work");
    } else if (a.programs > 0) {
      elem.classList.add("day-idle-only");
    } else {
      elem.classList.add("day-no-data");
      title = "Brak danych";
    }
    elem.setAttribute("title", title);
  }

  useEffect(() => {
    if (!fromRef.current || !toRef.current) return;

    const common: flatpickr.Options.Options = {
      locale: Polish,
      enableTime: true,
      time_24hr: true,
      dateFormat: "Y-m-d H:i",
      allowInput: true,
      onDayCreate: (_dObj, _dStr, instance, dayElem) => {
        // @ts-ignore
        const dateObj: Date = dayElem.dateObj || new Date(instance.currentYear, instance.currentMonth, Number(dayElem.textContent || "1"));
        decorateDay(dayElem, dateObj);
      },
      onMonthChange: (_sel, _str, instance) => {
        const anchor = new Date(instance.currentYear, instance.currentMonth, 1);
        fetchMonthActivity(anchor);
      },
      onOpen: (_sel, _str, instance) => {
        const anchor = instance.selectedDates?.[0] ?? new Date();
        fetchMonthActivity(anchor);
      },
    };

    fpFrom.current = flatpickr(fromRef.current, {
      ...common,
      defaultDate: new Date(from.replace(" ", "T")),
      onChange: (dates) => {
        const d = dates[0] || new Date();
        onChange(fmt(d), to);
      },
    });

    fpTo.current = flatpickr(toRef.current, {
      ...common,
      defaultDate: new Date(to.replace(" ", "T")),
      onChange: (dates) => {
        const d = dates[0] || new Date();
        onChange(from, fmt(d));
      },
    });

    return () => {
      fpFrom.current?.destroy();
      fpTo.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className ?? ""} style={{ display: "flex", gap: 12 }}>
      <div style={{ display: "grid" }}>
        <label className="text-muted">Zakres od</label>
        <input ref={fromRef} defaultValue={from.replace("T", " ")} className="date-input" />
      </div>
      <div style={{ display: "grid" }}>
        <label className="text-muted">do</label>
        <input ref={toRef} defaultValue={to.replace("T", " ")} className="date-input" />
      </div>
    </div>
  );
};

export default DateRangePickerWithActivity;
