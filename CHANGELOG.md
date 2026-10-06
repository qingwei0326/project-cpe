# Changelog

## 3.3.11

- Added `route-absent-addr-present` path classification plus explicit `v4_default_route` / `sipa_v4_addr` fields on connectivity failures, so "address present but default route gone" is visible without reading the raw route dump.
- Damped route-unreachable recovery: a 5 s confirmation recheck is now required before tearing down and reactivating the data context, so module re-attachment windows no longer trigger a futile re-dial (`GPRS is not attached`).
- Removed the `default via 192.168.66.2` route write from `configure_usb_network()`. It could add a competing default route on the device and black-hole the CPE's own traffic.
- Added usb0 link observability: `USB_PATH_STATE_CHANGE`, `USB_PATH_DOWN`, `USB_PATH_RECOVERED`.
- Added guarded usb0 link recovery (`USB_LINK_RECOVERY_START` / `DONE`): rebuild the gadget only when the link has been down without carrier for ~180 s, with a 30 min cooldown and at most 2 consecutive attempts.
- Bounded the operator scan with a 140 s timeout plus `OPERATOR_SCAN_START` / `OPERATOR_SCAN_DONE` events; a full `Scan()` can no longer hold the global serial lock indefinitely and stall every other management request.
- Added `CELLS_FETCH_SLOW` diagnostics for slow cell reads.

## 3.3.8

- Added immediate PDP recovery for a confirmed route-unreachable dual-stack failure.
- Added guarded `usb0` host-path stall detection and USB gadget recovery after a bearer fault.
- Added bounded recovery cooldowns and diagnostics events for data and USB path recovery.
