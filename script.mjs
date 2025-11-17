const TRW_VERSION = '0.0.1';

import { DynamicElement } from './percentTemplate.mjs';
import { statePotentialUpdate } from './updateCode.mjs';

/**
 * @typedef WeaponData
 * @property {String} name
 * @property {String} img
 * @property {String} [mod]
 */

/** Contains merged data from data.json (+ calamity.json optionally) */
let data = {};

/**
 * Resets the state of the run
 */
function stateReset() {
  const rstState = {
    terrariaVersion: data.terrariaVersion,
    trwVersion: TRW_VERSION,
    currentStage: 0, // index into "visible" stages
    weaponBlacklist: {},
    selectedWeapon: null,
    enableStageClearPreviousWeapons: true,
    sortWeapons: 'availabilityAndName',
    openWeaponList: false,
    // 'vanilla' | 'calamity' | 'both'
    modMode: 'vanilla'
  };
  return rstState;
}

let state = stateReset();

function toggleStageClear() {
  state.enableStageClearPreviousWeapons = !state.enableStageClearPreviousWeapons;
  stateChanged();
}

/** vanilla -> calamity -> both -> vanilla */
function toggleModMode() {
  if (state.modMode === 'vanilla') {
    state.modMode = 'calamity';
  } else if (state.modMode === 'calamity') {
    state.modMode = 'both';
  } else {
    state.modMode = 'vanilla';
  }

  // clamp currentStage to visible stages after mode change
  clampCurrentStage();
  stateChanged();
}

function stateChanged() {
  saveToLocal();
  updateElements();
}

const currentStage = new DynamicElement();
const availWeapons = new DynamicElement();
const optWeaponList = new DynamicElement();
const optStageClear = new DynamicElement();
const optModMode = new DynamicElement();

const randomWeaponPrompt = Object.assign(
  new DynamicElement(null, {}, true),
  {
    /** @type {WeaponData} */
    current: null
  }
);

const selectedWeapon = new DynamicElement(null, {}, true);

const weaponList = {
  /** @type {HTMLDivElement} */
  element: null
}

function lexOrder(a1, a2) {
  const l = Math.min(a1.length, a2.length);
  for(let i = 0; i < l; ++i) {
    if (a1[i] < a2[i]) {
      return -1;
    } else if (a1[i] > a2[i]) {
      return 1;
    }
  }
  if (a1.length < a2.length) {
    return -1;
  } else if (a1.length > a2.length) {
    return 1;
  } else {
    return 0;
  }
}

const SORTMODES = {
  'name': {
    label: 'Name',
    cmpFn: (w1, w2) => lexOrder([w1.name], [w2.name])
  },
  'availability': {
    label: 'Availability',
    cmpFn: (w1, w2) => lexOrder([!!state.weaponBlacklist[w1.name]], [!!state.weaponBlacklist[w2.name]])
  },
  'availabilityAndName': {
    label: 'Availability and Name',
    cmpFn: (w1, w2) => lexOrder([!!state.weaponBlacklist[w1.name], w1.name], [!!state.weaponBlacklist[w2.name], w2.name])
  }
};

/** Returns array of stages visible for current mode (or specified mode) */
function getVisibleStages(modMode = state.modMode) {
  const stages = Array.isArray(data.stages) ? data.stages : [];
  // If in vanilla mode, hide any stage that was marked calamityOnly
  if (modMode === 'vanilla') {
    return stages.filter(s => !s._calamityOnly);
  }
  // in 'calamity' and 'both' we show all stages (weapons are still filtered by mod mode)
  return stages;
}

/**
 * Ensure state.currentStage is a valid index into the currently visible stages
 */
function clampCurrentStage() {
  const vis = getVisibleStages(state.modMode);
  if (!Array.isArray(vis) || vis.length === 0) {
    state.currentStage = 0;
    return;
  }
  if (typeof state.currentStage !== 'number' || !Number.isFinite(state.currentStage)) {
    state.currentStage = 0;
  }
  state.currentStage = Math.min(Math.max(Math.floor(state.currentStage), 0), vis.length - 1);
}

/**
 * Gets all available weapons at the specified visible-stage index with the specified blacklist
 * @param {Number} [stageI] - The visible stage's index
 * @param {Object<String, Boolean>} [blacklist] - The weapons' blacklist
 * @param {String} [modMode] - 'vanilla' | 'calamity' | 'both' (defaults to state.modMode)
 * @returns {WeaponData[]} An array that contains all available weapons
 */
function getAvailableWeapons(stageI = 0, blacklist = state.weaponBlacklist, modMode = state.modMode) {
  let weapons = [];
  const stages = getVisibleStages(modMode);
  if (!Array.isArray(stages) || stages.length === 0) return [];

  stageI = Math.min(Math.max(stageI, 0), stages.length - 1);
  for (let i = 0; i <= stageI; i++) {
    if (state.enableStageClearPreviousWeapons && stages[i] && stages[i].clearPreviousWeapons) {
      weapons = [];
    }
    if (stages[i] && Array.isArray(stages[i].weapons)) {
      weapons.push(...stages[i].weapons);
    }
  }

  // Filter by modMode:
  const filteredByMod = weapons.filter(w => {
    const mod = (w && (w.mod || 'vanilla')).toString().toLowerCase();
    if (modMode === 'both') return true;
    if (modMode === 'vanilla') return mod === 'vanilla';
    if (modMode === 'calamity') return mod === 'calamity';
    return true;
  });

  return filteredByMod.filter(w => w && !blacklist[w.name]);
}

/**
 * Returns the name of the specified visible-stage
 * @param {Number} [stageI] - The visible stage's index
 * @returns {String} The name of the specified visible stage
 */
function getStageName(stageI = 0) {
  const stages = getVisibleStages(state.modMode);
  if (!Array.isArray(stages) || stages.length === 0) return "No Stages";
  stageI = Math.min(Math.max(stageI, 0), stages.length - 1);
  return stages[stageI].name;
}

/**
 * Picks a random weapon that is available at the specified visible-stage with the specified blacklist
 * honors state.modMode via getAvailableWeapons default parameter
 * @param {Number} [stageI] - The visible-stage's index
 * @param {Object<String, Boolean>} [blacklist] - The weapons' blacklist
 * @returns {WeaponData|undefined} A randomly picked weapon (or undefined if none available)
 */
function pickRandomWeapon(stageI = 0, blacklist = state.weaponBlacklist) {
  const availWeapons = getAvailableWeapons(stageI, blacklist, state.modMode);
  if (!availWeapons || availWeapons.length === 0) {
    return undefined;
  }
  return availWeapons[Math.floor(Math.random() * availWeapons.length)];
}

/**
 * Goes to the next visible stage
 */
function nextStage() {
  const vis = getVisibleStages(state.modMode);
  if (state.currentStage < vis.length - 1) {
    ++state.currentStage;
    stateChanged();
  }
}

/**
 * Goes back to the previous visible stage
 */
function previousStage() {
  if (state.currentStage > 0) {
    --state.currentStage;
    stateChanged();
  }
}

/**
 * Creates a new HTML string from the specified weapon
 * @param {WeaponData} weapon - The weapon to create the HTML string from
 * @returns {String} The HTML for the specified weapon
 */
function createWeaponHTML(weapon) {
  if (weapon === null || weapon === undefined) {
    return "None";
  }

  return `<img class="weaponImage" src="${weapon.img === undefined ? "" : weapon.img}"> ${weapon.name}`;
}

/**
 * Called when "getRandomWeapon" button is pressed
 */
function getRandomWeaponPressed() {
  randomWeaponPrompt.parent.classList.remove("hidden");
  
  const selWeapon = pickRandomWeapon(state.currentStage);
  randomWeaponPrompt.current = selWeapon;
  randomWeaponPrompt.update({ SELECTED_WEAPON: createWeaponHTML(selWeapon) });
}

/**
 * Populates the list of weapons and creates all needed elements
 */
function populateWeaponList() {
  weaponList.element.classList.toggle("hidden", !state.openWeaponList);
  if (!state.openWeaponList) {
    return;
  }

  while (weaponList.element.lastElementChild !== null) {
    weaponList.element.removeChild(weaponList.element.lastElementChild);
  }

  const allWeapons = getAvailableWeapons(state.currentStage, { }, state.modMode); // pass modMode
  allWeapons.sort(SORTMODES[state.sortWeapons].cmpFn);
  for (const weapon of allWeapons) {
    if (!weapon) continue;
    const name = weapon.name || "Unknown";
    const div = document.createElement("div");

    // create a DOM-safe id (no spaces or special chars)
    const safeId = `blacklistButton_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    const button = document.createElement("button");
    button.id = safeId;
    button.classList.add("defaultButton", "weaponListButton", "left");
    button.innerText = state.weaponBlacklist[name] ? "W" : "B";

    const label = document.createElement("label");
    label.innerHTML = `<span style="color: ${state.selectedWeapon !== null && state.selectedWeapon.name === name ? "blue" : state.weaponBlacklist[name] ? "red" : "white"}">${createWeaponHTML(weapon)}</span>`;
    label.classList.add("defaultText", "weaponListLabel");
    label.htmlFor = button.id;

    button.addEventListener("click", (ev) => {
      state.weaponBlacklist[name] = !state.weaponBlacklist[name];
      stateChanged();
    });

    div.appendChild(button);
    div.appendChild(label);

    weaponList.element.appendChild(div);
  };
}

/**
 * Updates all elements on the page with the right information
 */
function updateElements() {
  // make sure currentStage is valid for the current mode
  clampCurrentStage();

  const vis = getVisibleStages(state.modMode);
  currentStage.update({ CURRENT_STAGE: `${getStageName(state.currentStage)} (${state.currentStage + 1}/${vis.length})` });
  selectedWeapon.update({ CURRENT_WEAPON: createWeaponHTML(state.selectedWeapon) });
  availWeapons.update({ WEAPON_COUNT: getAvailableWeapons(state.currentStage, state.weaponBlacklist, state.modMode).length });
  optWeaponList.update({ ACTION: state.openWeaponList ? "Close" : "Open" });
  optStageClear.update({ ACTION: state.enableStageClearPreviousWeapons ? "Disable" : "Enable" });
  optModMode.update({ MOD_ACTION: state.modMode }); // show current mode (vanilla|calamity|both)

  populateWeaponList();
}

/**
 * Toggles weapon list's visibility
 */
function toggleWeaponList() {
  state.openWeaponList = !state.openWeaponList;
  stateChanged();
}

/**
 * Accepts or rejects the currently random picked weapon
 * @param {Boolean} accept - Whether or not to accept the weapon
 * @param {Boolean} addToBlacklist - Whether or not to add the weapon to the blacklist
 */
function confirmRandomWeapon(accept = true, addToBlacklist = true) {
  randomWeaponPrompt.parent.classList.add("hidden");
  state.selectedWeapon = accept ? randomWeaponPrompt.current : null;
  if (addToBlacklist && randomWeaponPrompt.current) {
    state.weaponBlacklist[randomWeaponPrompt.current.name] = true;
  }
  stateChanged();
}

function stateSave() {
  return JSON.stringify(state);
}

/**
 * Saves the current state to localStorage
 */
function saveToLocal() {
  localStorage.clear(); // Needed?
  localStorage.setItem("state", stateSave());
}

/**
 * Saves the current state to localStorage
 */
function saveToFile() {
  const blob = new Blob([stateSave()], {
    type: "application/json"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "TerrariaRandomWeapon.save";
  //document.body.appendChild(a);
  a.click();
  //document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function stateLoad(str) {
  const otherState = statePotentialUpdate(JSON.parse(str) || {});
  state = Object.assign(
    stateReset(),
    otherState
  );
  // clamp currentStage to the currently visible stages
  clampCurrentStage();
  stateChanged(); // Update datastore I guess???
}

/**
 * Loads a saved state from localStorage
 */
function loadFromLocal() {
  stateLoad(localStorage.getItem("state"));
}

function loadFromFile() {
  const i = document.createElement("input");
  i.type = "file";
  i.accept = ".save"; //"application/json";

  i.addEventListener("change", ev => {
    const file = ev.target.files[0];
    
    const reader = new FileReader();

    // here we tell the reader what to do when it's done reading...
    reader.addEventListener("load", readerEvent => {
      stateLoad(readerEvent.target.result);
    });
    
    reader.readAsText(file, "UTF-8");
  });

  //document.body.appendChild(i);
  i.click();
  //document.body.removeChild(i);
}

window.addEventListener("load", async () => {
  currentStage.element = document.getElementById("currentStage");
  availWeapons.element = document.getElementById("availWeapons");
  randomWeaponPrompt.element = document.getElementById("randomlySelectedWeapon");
  selectedWeapon.element = document.getElementById("selectedWeapon");
  weaponList.element = document.getElementById("weaponList");
  optWeaponList.element = document.getElementById("optWeaponList");
  optStageClear.element = document.getElementById("optStageClear");
  optModMode.element = document.getElementById("optModMode");

  // --- Load base data and optional calamity.json, merging with placement rules ---
  const base = await (await fetch("data.json")).json();

  // try to load calamity.json (optional)
  let calamityData = null;
  try {
    const resp = await fetch("calamity.json");
    if (resp.ok) calamityData = await resp.json();
  } catch (e) {
    calamityData = null;
  }

  if (calamityData && Array.isArray(calamityData.stages)) {
    for (const cStage of calamityData.stages) {
      // normalize weapons and mark as calamity
      const cWeapons = (Array.isArray(cStage.weapons) ? cStage.weapons : [])
        .map(w => Object.assign({}, w, { mod: 'calamity' }));

      // if a stage with same name exists, merge into it
      const existIdx = base.stages.findIndex(s => s.name === cStage.name);
      if (existIdx >= 0) {
        base.stages[existIdx].weapons = (base.stages[existIdx].weapons || []).concat(cWeapons);
        if (cStage.clearPreviousWeapons) base.stages[existIdx].clearPreviousWeapons = true;
        continue;
      }

      // determine insertion index for a new calamity-only stage
      let insertAt = base.stages.length; // default: append

      // numeric position has highest priority (0-based)
      if (typeof cStage.position === 'number' && Number.isFinite(cStage.position)) {
        const pos = Math.floor(cStage.position);
        insertAt = Math.max(0, Math.min(pos, base.stages.length));
      }
      // insertAfter stage name
      else if (typeof cStage.insertAfter === 'string') {
        const afterIdx = base.stages.findIndex(s => s.name === cStage.insertAfter);
        if (afterIdx >= 0) insertAt = afterIdx + 1;
      }
      // insertBefore stage name
      else if (typeof cStage.insertBefore === 'string') {
        const beforeIdx = base.stages.findIndex(s => s.name === cStage.insertBefore);
        if (beforeIdx >= 0) insertAt = beforeIdx;
      }

      const newStage = {
        name: cStage.name,
        clearPreviousWeapons: !!cStage.clearPreviousWeapons,
        weapons: cWeapons,
        // internal flag used to hide this stage in vanilla mode if set in calamity.json
        _calamityOnly: !!cStage.calamityOnly
      };

      base.stages.splice(insertAt, 0, newStage);
    }
  }

  data = base;

  new DynamicElement(
    document.getElementById("credits"),
    {
      DATA_PROVIDER: data.$meta.author,
      TRW_VERSION: TRW_VERSION,
      TERRARIA_VERSION: data.terrariaVersion
    }
  );

  loadFromLocal();

  // Exported functions for the page
  window.trw = {
    getRandomWeaponPressed,
    nextStage,
    previousStage,
    toggleWeaponList,
    toggleStageClear,
    toggleModMode,
    confirmRandomWeapon,
    saveToFile,
    loadFromFile,
  };

});