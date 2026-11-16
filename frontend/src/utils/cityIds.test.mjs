// Run: node --test src/utils/cityIds.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCityIds, isAllCities, toggleCityId, cityIdsLabel } from './cityIds.js'

test('parses the comma list, ignoring blanks and spaces', () => {
  assert.deepEqual(parseCityIds(' 1, 2,,3 '), ['1', '2', '3'])
  assert.deepEqual(parseCityIds(''), [])
  assert.deepEqual(parseCityIds(null), [])
})

test('empty or 0 means all cities (same rule as the booking API)', () => {
  assert.equal(isAllCities(''), true)
  assert.equal(isAllCities('0'), true)
  assert.equal(isAllCities('1,2'), false)
})

test('toggling adds and removes a city, sorted numerically', () => {
  assert.equal(toggleCityId('1', '2'), '1,2')
  assert.equal(toggleCityId('10,2', '1'), '1,2,10')
  assert.equal(toggleCityId('1,2', '1'), '2')
})

test('picking a city while on All cities starts a fresh list', () => {
  assert.equal(toggleCityId('0', '2'), '2')
  assert.equal(toggleCityId('', '2'), '2')
})

test('removing the last city falls back to All cities, never an empty value', () => {
  assert.equal(toggleCityId('2', '2'), '0')
})

test('label shows names, keeps unknown ids visible', () => {
  const cities = [{ id: 1, title: 'Indore' }, { id: 2, title: 'Kota' }]
  assert.equal(cityIdsLabel('1,2', cities), 'Indore, Kota')
  assert.equal(cityIdsLabel('2,9', cities), 'Kota, City #9')
  assert.equal(cityIdsLabel('0', cities), 'All cities')
})
