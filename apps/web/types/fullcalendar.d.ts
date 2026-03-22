// FullCalendar 6.x class component is not compatible with React 19 types.
// This module augmentation provides a functional-component wrapper type
// until FullCalendar ships React 19 support.
declare module "@fullcalendar/react" {
  import { CalendarOptions, CalendarApi } from "@fullcalendar/core";
  import React from "react";

  interface FullCalendarProps extends CalendarOptions {}

  export default class FullCalendar extends React.Component<FullCalendarProps> {
    getApi(): CalendarApi;
    render(): React.ReactNode;
  }
}
