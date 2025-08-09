import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

// Checks Google Calendar for free/busy times and returns free intervals between timeMin and timeMax
export async function checkCalendarAvailability(
  timeMin,
  timeMax,
  google_service_account_key,
  google_calendar_email
) {
  try {
    // Initialize Google Calendar API with service account credentials
    const credentials = google_service_account_key;
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });

    const calendar = google.calendar({ version: "v3", auth });

    const calendarId = google_calendar_email;

    // Get busy times from calendar
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin || new Date().toISOString(),
        timeMax:
          timeMax || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
        items: [{ id: calendarId }],
      },
    });

    const busyTimes = response.data.calendars[calendarId].busy || [];

    // Find free time slots (simplified logic)
    const freeSlots = [];
    let currentTime = new Date(timeMin || new Date());
    const endTime = new Date(
      timeMax || new Date(Date.now() + 24 * 60 * 60 * 1000)
    );

    for (const busy of busyTimes) {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);

      // If there's a gap before this busy period, it's free
      if (currentTime < busyStart) {
        freeSlots.push({
          start: currentTime.toISOString(),
          end: busyStart.toISOString(),
        });
      }

      currentTime = busyEnd;
    }

    // Add remaining time after last busy period
    if (currentTime < endTime) {
      freeSlots.push({
        start: currentTime.toISOString(),
        end: endTime.toISOString(),
      });
    }

    return {
      busy: busyTimes,
      free: freeSlots,
    };
  } catch (error) {
    console.error("Error checking calendar availability:", error);
    return { error: error.message };
  }
}

// Helper to get local parts in a specific IANA time zone
function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: weekdayMap[map.weekday?.toLowerCase()] ?? undefined,
  };
}

// Splits each free interval into 1-hour slots aligned to the top of the hour in the specified time zone
function generateHourlySlots(slots, timeZone, work_start_hour, work_end_hour) {
  const WORK_START_HOUR = parseInt(work_start_hour, 10);
  const WORK_END_HOUR = parseInt(work_end_hour, 10);

  const hourlySlots = [];

  slots.forEach(({ start, end }) => {
    let current = new Date(start);
    const endDate = new Date(end);

    // Align to the next top-of-hour in the target time zone
    let parts = getZonedParts(current, timeZone);
    while (parts.minute !== 0) {
      current = new Date(current.getTime() + 60 * 1000);
      parts = getZonedParts(current, timeZone);
    }

    // Only include slots that fit fully within the interval
    while (current.getTime() + 60 * 60 * 1000 <= endDate.getTime()) {
      const slotStart = new Date(current);
      const slotEnd = new Date(current.getTime() + 60 * 60 * 1000);

      const startParts = getZonedParts(slotStart, timeZone);
      const isWeekday = startParts.weekday >= 1 && startParts.weekday <= 5; // Mon-Fri
      const withinHours =
        startParts.hour >= WORK_START_HOUR && startParts.hour < WORK_END_HOUR;

      if (isWeekday && withinHours) {
        hourlySlots.push({ start: slotStart, end: slotEnd });
      }

      current = new Date(current.getTime() + 60 * 60 * 1000);
    }
  });

  return hourlySlots;
}

// Groups consecutive hourly slots into intervals
function groupSlotsIntoIntervals(slots) {
  if (slots.length === 0) return [];

  const intervals = [];
  let currentInterval = {
    start: new Date(slots[0].start),
    end: new Date(slots[0].end),
  };

  for (let i = 1; i < slots.length; i++) {
    const currentSlot = slots[i];
    const previousEnd = new Date(currentInterval.end);

    // Check if this slot is consecutive (starts exactly when the previous ends)
    if (currentSlot.start.getTime() === previousEnd.getTime()) {
      // Extend the current interval
      currentInterval.end = new Date(currentSlot.end);
    } else {
      // End the current interval and start a new one
      intervals.push(currentInterval);
      currentInterval = {
        start: new Date(currentSlot.start),
        end: new Date(currentSlot.end),
      };
    }
  }

  // Add the last interval
  intervals.push(currentInterval);

  return intervals;
}

// Returns an object with available time intervals grouped by date for the next N days, weekdays only, in UTC+0 or requested UTC offset
export async function formattedCalendarAvailability(
  timeZone,
  days,
  google_service_account_key,
  google_calendar_email,
  work_start_hour,
  work_end_hour
) {
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const result = await checkCalendarAvailability(
    now.toISOString(),
    sevenDaysLater.toISOString(),
    google_service_account_key,
    google_calendar_email
  );

  // Split into 1-hour slots and group into intervals
  const hourlySlots = generateHourlySlots(
    result.free,
    timeZone || "Europe/Riga",
    work_start_hour,
    work_end_hour
  );
  if (hourlySlots.length === 0) {
    return [];
  }

  // Group consecutive slots into intervals
  const intervals = groupSlotsIntoIntervals(hourlySlots);
  if (intervals.length === 0) {
    return [];
  }

  // Format each interval as a JSON object with requested UTC offset
  const intervalObjects = intervals.map(({ start, end }) => {
    const day = start
      .toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: timeZone || "Europe/Riga",
      })
      .toLowerCase();
    const month = start.toLocaleDateString("en-US", {
      month: "long",
      timeZone: timeZone || "Europe/Riga",
    });
    const date = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      timeZone: timeZone || "Europe/Riga",
    }).format(start);
    const year = new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      timeZone: timeZone || "Europe/Riga",
    }).format(start);
    const monthNum = new Intl.DateTimeFormat("en-GB", {
      month: "2-digit",
      timeZone: timeZone || "Europe/Riga",
    })
      .format(start)
      .toString()
      .padStart(2, "0");
    const dateNum = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      timeZone: timeZone || "Europe/Riga",
    })
      .format(start)
      .toString()
      .padStart(2, "0");
    const dateStr = `${year}-${monthNum}-${dateNum}`;

    // Format start and end time in the specified time zone
    const startTime = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timeZone || "Europe/Riga",
    }).format(start);
    const endTime = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timeZone || "Europe/Riga",
    }).format(end);

    const interval = `${startTime}-${endTime} ${timeZone || "Europe/Riga"}`;

    return { day, month, date, dateStr, interval };
  });

  // Group intervals by dateStr
  const grouped = {};
  for (const intervalObj of intervalObjects) {
    if (!grouped[intervalObj.dateStr]) {
      grouped[intervalObj.dateStr] = {
        day: intervalObj.day,
        month: intervalObj.month,
        date: intervalObj.date,
        intervals: [],
      };
    }
    grouped[intervalObj.dateStr].intervals.push(intervalObj.interval);
  }

  return grouped;
}
