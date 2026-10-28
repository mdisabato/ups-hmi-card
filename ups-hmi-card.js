/**
 * UPS HMI Card - ISA-101 High Performance Design
 * Companion to generator-hmi-card (https://github.com/jtubb/generator-hmi-card);
 * styling and layout from that card by jtubb, adapted for UPS data.
 * Works with the NUT and APC UPS Daemon (apcupsd) integrations.
 *
 * @author Michael Disabato
 * @license MIT
 */

const CARD_VERSION = '1.0.0';

console.info(
  `%c UPS-HMI-CARD %c v${CARD_VERSION} %c ISA-101 `,
  'color: #333; font-weight: bold; background: #d0d0d0',
  'color: #d0d0d0; font-weight: bold; background: #333',
  'color: #fff; font-weight: bold; background: #0066cc'
);

// Default entity suffixes per integration. A value of null means the
// integration has no such sensor; the card hides or derives that value.
const PRESETS = {
  nut: {
    status: 'status_data',
    input_voltage: 'input_voltage',
    transfer_low: 'low_voltage_transfer',
    transfer_high: 'high_voltage_transfer',
    nominal_input_voltage: 'nominal_input_voltage',
    battery_charge: 'battery_charge',
    battery_charge_low: 'low_battery_setpoint',
    battery_charge_warning: 'warning_battery_setpoint',
    battery_voltage: 'battery_voltage',
    battery_nominal_voltage: 'nominal_battery_voltage',
    load: 'load',
    nominal_power: 'nominal_real_power',
    runtime: 'battery_runtime',
    runtime_low: 'low_battery_runtime',
    time_on_battery: null,
    transfer_count: null,
    battery_date: 'battery_date',
    battery_mfr_date: 'battery_manuf_date',
    self_test: 'self_test_result',
    beeper: 'beeper_status',
    sensitivity: 'input_power_sensitivity',
    last_transfer: null,
  },
  apcupsd: {
    status: 'status',
    input_voltage: 'input_voltage',
    transfer_low: 'transfer_low',
    transfer_high: 'transfer_high',
    nominal_input_voltage: 'nominal_input_voltage',
    battery_charge: 'battery',
    battery_charge_low: 'battery_shutdown',
    battery_charge_warning: null,
    battery_voltage: 'battery_voltage',
    battery_nominal_voltage: 'battery_nominal_voltage',
    load: 'load',
    nominal_power: 'nominal_output_power',
    runtime: 'time_left',
    runtime_low: null,
    time_on_battery: 'time_on_battery',
    transfer_count: 'transfer_count',
    battery_date: 'battery_replaced',
    battery_mfr_date: null,
    self_test: 'last_self_test',
    beeper: null,
    sensitivity: 'sensitivity',
    last_transfer: 'last_transfer',
  },
};

class UpsHMICard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._initialized = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._initialized) {
      this._updateValues();
    } else {
      this._buildCard();
      this._initialized = true;
    }
  }

  setConfig(config) {
    const integration = (config.integration || 'nut').toLowerCase();
    if (!PRESETS[integration]) {
      throw new Error(`integration must be one of: ${Object.keys(PRESETS).join(', ')}`);
    }
    if (!config.device_name && !config.entity_prefix) {
      throw new Error('Set device_name (e.g. ups_apc550) or entity_prefix');
    }
    const normalizedName = (config.device_name || '').toLowerCase().replace(/\s+/g, '_');

    this._config = {
      title: 'UPS',
      entity_prefix: normalizedName ? `sensor.${normalizedName}_` : '',
      nominal_power: null,
      battery_age_warning: 3,
      battery_age_alarm: 5,
      load_warning: 80,
      load_alarm: 95,
      show_maintenance: true,
      ...config,
      integration,
    };

    // Optional Genmon link: lets LOAD SOURCE show GENERATOR.
    const gen = config.generator ? config.generator.toLowerCase().replace(/\s+/g, '_') : null;
    this._generator = gen ? {
      running: `binary_sensor.${gen}_generator_running`,
      transfer: `binary_sensor.${gen}_transfer_to_generator`,
      outage: `binary_sensor.${gen}_system_in_outage`,
      ...(config.generator_entities || {}),
    } : null;

    if (this._initialized) {
      this._initialized = false;
      if (this._hass) {
        this._buildCard();
        this._initialized = true;
      }
    }
  }

  getCardSize() {
    return 9;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  // Resolve a card key to an entity_id, or null when the integration has none.
  //   1. config.entities[key]   explicit override (full entity_id)
  //   2. preset suffix          sensor.<device_name>_<suffix>
  _resolveEntity(key) {
    const override = this._config.entities && this._config.entities[key];
    if (override) return override;
    const suffix = PRESETS[this._config.integration][key];
    if (!suffix) return null;
    return this._config.entity_prefix + suffix;
  }

  _stateObj(key) {
    const id = this._resolveEntity(key);
    return id ? this._hass?.states[id] : undefined;
  }

  _getState(key) {
    const obj = this._stateObj(key);
    if (!obj || obj.state === 'unavailable' || obj.state === 'unknown') return '--';
    return obj.state;
  }

  _getNumber(key) {
    const n = parseFloat(this._getState(key));
    return isNaN(n) ? null : n;
  }

  _isOn(entityId) {
    return this._hass?.states[entityId]?.state === 'on';
  }

  // Seconds from a duration sensor, honouring its unit.
  _getSeconds(key) {
    const obj = this._stateObj(key);
    const n = this._getNumber(key);
    if (n === null) return null;
    const unit = (obj.attributes.unit_of_measurement || 's').toLowerCase();
    if (unit.startsWith('h')) return n * 3600;
    if (unit.startsWith('min')) return n * 60;
    return n;
  }

  _formatDuration(seconds) {
    if (seconds === null) return '--';
    if (seconds < 60) return `${Math.round(seconds)} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h} h ${m} min`;
  }

  _showMoreInfo(key) {
    const entityId = key.includes('.') ? key : this._resolveEntity(key);
    if (!entityId) return;
    const event = new Event('hass-more-info', { bubbles: true, composed: true });
    event.detail = { entityId };
    this.dispatchEvent(event);
  }

  // Normalise NUT (OL OB LB RB CHRG ...) and apcupsd (ONLINE ONBATT LOWBATT ...)
  // status strings into one set of flags.
  _getFlags() {
    const obj = this._stateObj('status');
    const raw = obj ? obj.state : 'unavailable';
    const tokens = raw.toUpperCase().split(/\s+/);
    const has = (...names) => names.some((n) => tokens.includes(n));
    return {
      raw,
      commlost: raw === 'unavailable' || raw === 'unknown' || has('COMMLOST'),
      online: has('OL', 'ONLINE'),
      onbatt: has('OB', 'ONBATT'),
      lowbatt: has('LB', 'LOWBATT'),
      replace: has('RB', 'REPLACEBATT'),
      overload: has('OVER', 'OVERLOAD'),
      charging: has('CHRG'),
      trim: has('TRIM'),
      boost: has('BOOST'),
      selftest: has('CAL', 'SELFTEST'),
      shutdown: has('FSD', 'SHUTTING'),
      off: has('OFF'),
      since: obj ? obj.last_changed : null,
    };
  }

  // ISA-101 levels: 0=normal (gray) 1=abnormal (blue) 2=warning (amber) 3=alarm (red)
  _getUpsStatus(f) {
    if (f.commlost) return { level: 3, text: 'COMMS LOST' };
    if (f.shutdown) return { level: 3, text: 'SHUTDOWN' };
    if (f.overload) return { level: 3, text: 'OVERLOAD' };
    if (f.onbatt && f.lowbatt) return { level: 3, text: 'LOW BATTERY' };
    if (f.selftest) return { level: 1, text: 'SELF TEST' };
    if (f.onbatt) return { level: 2, text: 'ON BATTERY' };
    if (f.replace) return { level: 2, text: 'REPLACE BATT' };
    if (f.off) return { level: 2, text: 'OFF' };
    if (f.trim) return { level: 1, text: 'AVR TRIM' };
    if (f.boost) return { level: 1, text: 'AVR BOOST' };
    if (f.charging) return { level: 1, text: 'CHARGING' };
    if (f.online) return { level: 0, text: 'ONLINE' };
    return { level: 0, text: f.raw.toUpperCase().substring(0, 12) };
  }

  _getUtilityStatus(f) {
    const genOutage = this._generator && this._isOn(this._generator.outage);
    if ((f.onbatt && !f.selftest) || genOutage) return { level: 3, text: 'OUTAGE' };
    if (f.commlost) return { level: 0, text: '--' };
    return { level: 0, text: 'NORMAL' };
  }

  _getLoadSource(f) {
    if (f.commlost) return { level: 0, text: '--' };
    if (f.onbatt) return { level: 2, text: 'BATTERY' };
    if (this._generator) {
      const running = this._isOn(this._generator.running);
      const transferred = this._isOn(this._generator.transfer);
      const outage = this._isOn(this._generator.outage);
      if (transferred || (running && outage)) return { level: 1, text: 'GENERATOR' };
    }
    return { level: 0, text: 'UTILITY' };
  }

  // Bar fill percent plus a level from explicit warning/alarm bands.
  // bands: { alarmLow, warnLow, warnHigh, alarmHigh } (any may be undefined)
  _barStatus(value, min, max, bands) {
    if (value === null) return { percent: 0, level: 0 };
    const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    let level = 0;
    if ((bands.alarmLow !== undefined && value <= bands.alarmLow) ||
        (bands.alarmHigh !== undefined && value >= bands.alarmHigh)) level = 3;
    else if ((bands.warnLow !== undefined && value <= bands.warnLow) ||
             (bands.warnHigh !== undefined && value >= bands.warnHigh)) level = 2;
    return { percent, level };
  }

  _updateBar(id, value, text, min, max, scale, bands) {
    const status = this._barStatus(value, min, max, bands);
    const bar = this.shadowRoot.getElementById(`${id}-bar`);
    const valueEl = this.shadowRoot.getElementById(`${id}-value`);
    const scaleEl = this.shadowRoot.getElementById(`${id}-scale`);
    if (bar) {
      // Keep an alarm visible even when the value sits at the bottom of the scale (e.g. 0 V)
      bar.style.width = (status.level === 3 ? Math.max(status.percent, 6) : status.percent) + '%';
      bar.className = 'analog-bar-fill level-' + status.level;
    }
    if (valueEl) valueEl.textContent = value === null ? '--' : text;
    if (scaleEl) scaleEl.innerHTML = scale.map((s) => `<span>${s}</span>`).join('');
  }

  _round(n, digits = 0) {
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  }

  _parseDate(value) {
    if (!value || value === '--') return null;
    const d = new Date(value.trim().replace(/\//g, '-').substring(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  // Newest of the install/replaced date and the manufacture date. NUT units often
  // report a factory placeholder (e.g. 2001/09/25) as battery.date.
  _getBatteryDate() {
    const dates = [this._getState('battery_date'), this._getState('battery_mfr_date')]
      .map((v) => this._parseDate(v)).filter(Boolean);
    if (!dates.length) return null;
    return new Date(Math.max(...dates.map((d) => d.getTime())));
  }

  _getBatteryAgeStatus(f) {
    const date = this._getBatteryDate();
    if (!date) return { level: 0, text: '--' };
    const years = (Date.now() - date.getTime()) / (365.25 * 86400 * 1000);
    const text = years < 1 ? `${Math.round(years * 12)} mo` : `${years.toFixed(1)} y`;
    if (years >= this._config.battery_age_alarm) return { level: 3, text };
    if (years >= this._config.battery_age_warning) return { level: 2, text };
    return { level: 0, text };
  }

  _getSelfTestStatus() {
    const v = this._getState('self_test');
    if (v === '--') return { level: 0, text: '--' };
    const lower = v.toLowerCase();
    if (lower === 'ok' || lower.includes('pass')) return { level: 0, text: 'PASS' };
    if (lower === 'ip' || lower.includes('progress')) return { level: 1, text: 'TESTING' };
    if (lower === 'no' || lower.includes('no test') || lower.includes('none')) return { level: 0, text: 'NONE' };
    if (lower === 'ng' || lower === 'bt' || lower.includes('fail') || lower.includes('warning')) {
      return { level: 3, text: 'FAIL' };
    }
    return { level: 1, text: v.substring(0, 8).toUpperCase() };
  }

  _getNominalPower() {
    if (this._config.nominal_power) return parseFloat(this._config.nominal_power);
    return this._getNumber('nominal_power');
  }

  _updateValues() {
    if (!this._hass || !this.shadowRoot) return;
    const f = this._getFlags();

    this._updateStatusIndicator('ups', this._getUpsStatus(f));
    this._updateStatusIndicator('utility', this._getUtilityStatus(f));
    this._updateStatusIndicator('source', this._getLoadSource(f));

    // Input voltage, scaled between the UPS's own transfer points
    const vin = this._getNumber('input_voltage');
    const vNom = this._getNumber('nominal_input_voltage') || 120;
    const vLow = this._getNumber('transfer_low') || this._round(vNom * 0.75);
    const vHigh = this._getNumber('transfer_high') || this._round(vNom * 1.15);
    this._updateBar('input-voltage', vin, `${vin} V`, vLow, vHigh, [vLow, vNom, vHigh], {
      alarmLow: vLow, alarmHigh: vHigh,
      warnLow: vLow + (vNom - vLow) * 0.25, warnHigh: vHigh - (vHigh - vNom) * 0.25,
    });

    // Battery charge, with the UPS's warning / low setpoints as bands
    const charge = this._getNumber('battery_charge');
    const chargeLow = this._getNumber('battery_charge_low') ?? 10;
    const chargeWarn = this._getNumber('battery_charge_warning') ?? 50;
    this._updateBar('charge', charge, `${this._round(charge ?? 0)} %`, 0, 100,
      [0, 50, 100], { alarmLow: chargeLow, warnLow: chargeWarn });

    // Load, in watts when the rated power is known
    const load = this._getNumber('load');
    const pNom = this._getNominalPower();
    const loadText = load === null ? '--'
      : pNom ? `${this._round(load)} % · ${this._round(load * pNom / 100)} W` : `${this._round(load)} %`;
    this._updateBar('load', load, loadText, 0, 100,
      [0, pNom ? `${this._round(pNom / 2)} W` : '50', pNom ? `${pNom} W` : '100'],
      { warnHigh: this._config.load_warning, alarmHigh: this._config.load_alarm });

    // Battery voltage around the pack's nominal (12 V or 24 V lead-acid)
    const vb = this._getNumber('battery_voltage');
    const vbNom = this._getNumber('battery_nominal_voltage') || 12;
    const vbMin = this._round(vbNom * 0.875, 1);
    const vbMax = this._round(vbNom * 1.2, 1);
    this._updateBar('battery-voltage', vb, `${vb} V`, vbMin, vbMax, [vbMin, vbNom, vbMax], {
      alarmLow: vbMin, alarmHigh: vbMax,
      warnLow: vbNom * 0.95, warnHigh: vbNom * 1.175,
    });

    // Runtime remaining
    const runtime = this._getSeconds('runtime');
    const runtimeLow = this._getSeconds('runtime_low') ?? 120;
    const runtimeEl = this.shadowRoot.getElementById('runtime');
    if (runtimeEl) {
      runtimeEl.textContent = this._formatDuration(runtime);
      let level = 0;
      if (runtime !== null && runtime <= runtimeLow) level = 3;
      else if (runtime !== null && runtime <= runtimeLow * 5) level = 2;
      runtimeEl.className = 'value-display text-level-' + level;
    }

    // Second value block: time on battery during an outage, otherwise transfer count / rating
    const label2 = this.shadowRoot.getElementById('value2-label');
    const value2 = this.shadowRoot.getElementById('value2');
    const block2 = this.shadowRoot.getElementById('value2-block');
    if (label2 && value2) {
      if (f.onbatt) {
        let secs = this._getSeconds('time_on_battery');
        if (!secs && f.since) secs = (Date.now() - new Date(f.since).getTime()) / 1000;
        label2.textContent = 'On Battery';
        value2.textContent = this._formatDuration(secs);
        block2.dataset.entity = this._resolveEntity('time_on_battery') ? 'time_on_battery' : 'status';
      } else if (this._resolveEntity('transfer_count')) {
        label2.textContent = 'Transfers';
        value2.textContent = this._getState('transfer_count');
        block2.dataset.entity = 'transfer_count';
      } else {
        label2.textContent = 'Rated Power';
        value2.textContent = pNom ? `${pNom} W` : '--';
        block2.dataset.entity = 'nominal_power';
      }
    }

    if (this._config.show_maintenance) {
      this._updateMaintenanceIndicator('batt-age', this._getBatteryAgeStatus(f));
      this._updateMaintenanceIndicator('self-test', this._getSelfTestStatus());
      this._updateMaintenanceIndicator('replace',
        f.commlost ? { level: 0, text: '--' } : f.replace ? { level: 3, text: 'REPLACE' } : { level: 0, text: 'OK' });
      this._updateMaintenanceIndicator('comms',
        f.commlost ? { level: 3, text: 'LOST' } : { level: 0, text: 'OK' });
    }

    // Footer
    const footer = this.shadowRoot.getElementById('footer-info');
    if (footer) {
      const parts = [];
      const date = this._getBatteryDate();
      if (date) parts.push(`Battery ${date.toISOString().substring(0, 10)}`);
      const lastTransfer = this._getState('last_transfer');
      if (lastTransfer !== '--') parts.push(`Last transfer: ${lastTransfer}`);
      const sens = this._getState('sensitivity');
      if (sens !== '--') parts.push(`Sensitivity ${sens}`);
      const beeper = this._getState('beeper');
      if (beeper !== '--') parts.push(`Beeper ${beeper}`);
      footer.textContent = parts.join(' · ') || '--';
    }
  }

  _updateStatusIndicator(id, status) {
    const el = this.shadowRoot.getElementById(`${id}-status`);
    const indicator = this.shadowRoot.getElementById(`${id}-indicator`);
    if (el) el.textContent = status.text;
    if (indicator) indicator.className = 'status-indicator level-' + status.level;
  }

  _updateMaintenanceIndicator(id, status) {
    const el = this.shadowRoot.getElementById(`${id}-status`);
    const indicator = this.shadowRoot.getElementById(`${id}-indicator`);
    if (el) el.textContent = status.text;
    if (indicator) indicator.className = 'maint-indicator level-' + status.level;
  }

  _analogItem(id, label, entityKey) {
    return `
      <div class="analog-item clickable" data-entity="${entityKey}">
        <div class="analog-label">${label}</div>
        <div class="analog-container">
          <div class="analog-bar-fill" id="${id}-bar"></div>
          <span class="analog-value" id="${id}-value">--</span>
        </div>
        <div class="analog-scale" id="${id}-scale"></div>
      </div>`;
  }

  _buildCard() {
    if (!this._hass) return;

    const styles = `
      <style>
        :host {
          /* ISA-101 Color Palette (matches generator-hmi-card) */
          --isa-bg: #d4d4d4;
          --isa-bg-panel: #e8e8e8;
          --isa-bg-dark: #b8b8b8;
          --isa-border: #999999;
          --isa-text: #1a1a1a;
          --isa-text-dim: #666666;

          --isa-normal: #808080;
          --isa-abnormal: #0088cc;
          --isa-warning: #cc8800;
          --isa-alarm: #cc0000;

          font-family: 'Segoe UI', 'Arial', sans-serif;
          font-size: 13px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .hmi-container {
          background: var(--isa-bg);
          border: 1px solid var(--isa-border);
          border-radius: 4px;
          padding: 8px;
        }
        .hmi-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          background: var(--isa-bg-dark);
          border: 1px solid var(--isa-border);
          margin-bottom: 8px;
        }
        .hmi-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--isa-text);
          letter-spacing: 1px;
        }

        .status-row { display: flex; gap: 6px; margin-bottom: 8px; }
        .status-block {
          flex: 1;
          background: var(--isa-bg-panel);
          border: 1px solid var(--isa-border);
          padding: 8px 4px;
          text-align: center;
        }
        .status-label {
          font-size: 10px;
          color: var(--isa-text-dim);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
        .status-indicator {
          display: inline-block;
          padding: 4px 8px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 2px;
          min-width: 80px;
          white-space: nowrap;
        }

        .level-0 { background: var(--isa-normal); color: #fff; }
        .level-1 { background: var(--isa-abnormal); color: #fff; }
        .level-2 { background: var(--isa-warning); color: #fff; }
        .level-3 { background: var(--isa-alarm); color: #fff; animation: alarm-flash 1s infinite; }
        @keyframes alarm-flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

        .analog-section {
          background: var(--isa-bg-panel);
          border: 1px solid var(--isa-border);
          padding: 10px;
          margin-bottom: 8px;
        }
        .analog-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .analog-item { display: flex; flex-direction: column; }
        .analog-label {
          font-size: 10px;
          color: var(--isa-text-dim);
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .analog-container {
          position: relative;
          height: 24px;
          background: #fff;
          border: 1px solid var(--isa-border);
          overflow: hidden;
        }
        .analog-bar-fill { height: 100%; transition: width 0.3s ease; }
        .analog-bar-fill.level-0 { background: var(--isa-normal); }
        .analog-bar-fill.level-1 { background: var(--isa-abnormal); }
        .analog-bar-fill.level-2 { background: var(--isa-warning); }
        .analog-bar-fill.level-3 { background: var(--isa-alarm); }
        .analog-value {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 12px;
          font-weight: 600;
          color: #fff;
          white-space: nowrap;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8);
        }
        .analog-scale {
          display: flex;
          justify-content: space-between;
          font-size: 9px;
          color: var(--isa-text-dim);
          margin-top: 1px;
        }

        .clickable { cursor: pointer; }
        .clickable:hover { filter: brightness(0.95); }
        .clickable:active { filter: brightness(0.9); }

        .values-row { display: flex; gap: 8px; margin-bottom: 8px; }
        .value-block {
          flex: 1;
          background: var(--isa-bg-panel);
          border: 1px solid var(--isa-border);
          padding: 8px;
          text-align: center;
        }
        .value-label { font-size: 10px; color: var(--isa-text-dim); text-transform: uppercase; }
        .value-display { font-size: 18px; font-weight: 600; color: var(--isa-text); }
        .text-level-2 { color: var(--isa-warning); }
        .text-level-3 { color: var(--isa-alarm); animation: alarm-flash 1s infinite; }

        .maint-section {
          background: var(--isa-bg-panel);
          border: 1px solid var(--isa-border);
          padding: 8px;
          margin-bottom: 8px;
        }
        .maint-title {
          font-size: 10px;
          color: var(--isa-text-dim);
          text-transform: uppercase;
          margin-bottom: 6px;
          border-bottom: 1px solid var(--isa-border);
          padding-bottom: 4px;
        }
        .maint-grid { display: flex; gap: 6px; }
        .maint-item { flex: 1; text-align: center; }
        .maint-label { font-size: 9px; color: var(--isa-text-dim); margin-bottom: 2px; }
        .maint-indicator {
          display: inline-block;
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 600;
          border-radius: 2px;
        }

        .hmi-footer {
          font-size: 10px;
          color: var(--isa-text-dim);
          text-align: center;
          padding-top: 4px;
          border-top: 1px solid var(--isa-border);
        }
      </style>
    `;

    const genEntity = this._generator ? this._generator.running : 'status';
    const html = `
      <ha-card>
        <div class="hmi-container">
          <div class="hmi-header">
            <span class="hmi-title">${this._config.title}</span>
          </div>

          <div class="status-row">
            <div class="status-block clickable" data-entity="status">
              <div class="status-label">UPS</div>
              <div class="status-indicator" id="ups-indicator"><span id="ups-status">--</span></div>
            </div>
            <div class="status-block clickable" data-entity="${this._generator ? this._generator.outage : 'input_voltage'}">
              <div class="status-label">Utility</div>
              <div class="status-indicator" id="utility-indicator"><span id="utility-status">--</span></div>
            </div>
            <div class="status-block clickable" data-entity="${genEntity}">
              <div class="status-label">Load Source</div>
              <div class="status-indicator" id="source-indicator"><span id="source-status">--</span></div>
            </div>
          </div>

          <div class="analog-section">
            <div class="analog-grid">
              ${this._analogItem('input-voltage', 'Input Voltage', 'input_voltage')}
              ${this._analogItem('charge', 'Battery Charge', 'battery_charge')}
              ${this._analogItem('load', 'Load', 'load')}
              ${this._analogItem('battery-voltage', 'Battery Voltage', 'battery_voltage')}
            </div>
          </div>

          <div class="values-row">
            <div class="value-block clickable" data-entity="runtime">
              <div class="value-label">Runtime</div>
              <div class="value-display" id="runtime">--</div>
            </div>
            <div class="value-block clickable" id="value2-block" data-entity="status">
              <div class="value-label" id="value2-label">--</div>
              <div class="value-display" id="value2">--</div>
            </div>
          </div>

          ${this._config.show_maintenance ? `
          <div class="maint-section">
            <div class="maint-title">Maintenance Status</div>
            <div class="maint-grid">
              <div class="maint-item clickable" data-entity="${this._resolveEntity('battery_date') ? 'battery_date' : 'battery_mfr_date'}">
                <div class="maint-label">Battery Age</div>
                <div class="maint-indicator" id="batt-age-indicator"><span id="batt-age-status">--</span></div>
              </div>
              <div class="maint-item clickable" data-entity="self_test">
                <div class="maint-label">Self Test</div>
                <div class="maint-indicator" id="self-test-indicator"><span id="self-test-status">--</span></div>
              </div>
              <div class="maint-item clickable" data-entity="status">
                <div class="maint-label">Battery</div>
                <div class="maint-indicator" id="replace-indicator"><span id="replace-status">--</span></div>
              </div>
              <div class="maint-item clickable" data-entity="status">
                <div class="maint-label">Comms</div>
                <div class="maint-indicator" id="comms-indicator"><span id="comms-status">--</span></div>
              </div>
            </div>
          </div>
          ` : ''}

          <div class="hmi-footer">
            <span id="footer-info">--</span>
          </div>
        </div>
      </ha-card>
    `;

    this.shadowRoot.innerHTML = styles + html;

    this.shadowRoot.querySelectorAll('.clickable[data-entity]').forEach((el) => {
      el.addEventListener('click', () => this._showMoreInfo(el.dataset.entity));
    });

    this._updateValues();
  }
}

customElements.define('ups-hmi-card', UpsHMICard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ups-hmi-card',
  name: 'UPS HMI Card',
  description: 'ISA-101 HMI for NUT and APC UPS Daemon UPSs, with optional Genmon load-source link',
  preview: false,
});
