import dotenv from 'dotenv';
dotenv.config();

import sequelize, { District, DistrictAdmin } from '../database.js';

const DISTRICTS = [
  // Kigali City
  { name: 'Gasabo',     code: 'GSB' },
  { name: 'Kicukiro',   code: 'KCK' },
  { name: 'Nyarugenge', code: 'NYR' },
  // Eastern Province
  { name: 'Bugesera',   code: 'BGS' },
  { name: 'Gatsibo',    code: 'GTS' },
  { name: 'Kayonza',    code: 'KYZ' },
  { name: 'Kirehe',     code: 'KRH' },
  { name: 'Ngoma',      code: 'NGM' },
  { name: 'Nyagatare',  code: 'NYG' },
  { name: 'Rwamagana',  code: 'RWM' },
  // Northern Province
  { name: 'Burera',     code: 'BUR' },
  { name: 'Gakenke',    code: 'GKK' },
  { name: 'Gicumbi',    code: 'GCM' },
  { name: 'Musanze',    code: 'MSZ' },
  { name: 'Rulindo',    code: 'RLD' },
  // Southern Province
  { name: 'Gisagara',   code: 'GSG' },
  { name: 'Huye',       code: 'HUY' },
  { name: 'Kamonyi',    code: 'KMN' },
  { name: 'Muhanga',    code: 'MHG' },
  { name: 'Nyamagabe',  code: 'NYM' },
  { name: 'Nyamasheke', code: 'NYS' },
  { name: 'Nyanza',     code: 'NYZ' },
  { name: 'Nyaruguru',  code: 'NYU' },
  { name: 'Ruhango',    code: 'RHG' },
  // Western Province
  { name: 'Karongi',    code: 'KRG' },
  { name: 'Ngororero',  code: 'NGR' },
  { name: 'Nyabihu',    code: 'NYB' },
  { name: 'Rubavu',     code: 'RBV' },
  { name: 'Rusizi',     code: 'RSZ' },
  { name: 'Rutsiro',    code: 'RTS' },
];

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Seed districts
    for (const d of DISTRICTS) {
      await District.findOrCreate({
        where: { code: d.code },
        defaults: { name: d.name, code: d.code, status: 'active' },
      });
    }
    console.log(`✅ ${DISTRICTS.length} districts seeded`);

    // Seed district admins (one per major district)
    const admins = [
      { name: 'Gasabo District Admin',   email: 'admin.gasabo@gov.rw',   districtCode: 'GSB' },
      { name: 'Kicukiro District Admin', email: 'admin.kicukiro@gov.rw', districtCode: 'KCK' },
      { name: 'Musanze District Admin',  email: 'admin.musanze@gov.rw',  districtCode: 'MSZ' },
      { name: 'Huye District Admin',     email: 'admin.huye@gov.rw',     districtCode: 'HUY' },
      { name: 'Rubavu District Admin',   email: 'admin.rubavu@gov.rw',   districtCode: 'RBV' },
    ];

    for (const a of admins) {
      const district = await District.findOne({ where: { code: a.districtCode } });
      if (!district) continue;

      const [admin, created] = await DistrictAdmin.findOrCreate({
        where: { email: a.email },
        defaults: {
          name:        a.name,
          email:       a.email,
          password:    'Admin@1234',   // hashed by model hook
          phone:       '+250788000000',
          district_id: district.id,
          status:      'active',
        },
      });

      if (created) console.log(`✅ Created admin: ${a.email}`);
    }

    // Seed a sample approved organization + org admin user
    const gasabo = await District.findOne({ where: { code: 'GSB' } });
    if (gasabo) {
      const { Organization, User } = await import('../database.js');

      const [org] = await Organization.findOrCreate({
        where: { name: 'Demo School' },
        defaults: {
          name: 'Demo School',
          type: 'school',
          district_id: gasabo.id,
          status: 'approved',
          code: 'RWDEMO1',
          payment_status: 'paid',
          subscription_type: 'yearly',
          subscription_expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          contact_email: 'demo@school.rw',
          contact_phone: '+250788000001',
        },
      });

      await User.findOrCreate({
        where: { email: 'orgadmin@demo.rw' },
        defaults: {
          name: 'Demo Org Admin',
          email: 'orgadmin@demo.rw',
          password: 'Admin@1234',
          role: 'organization_admin',
          organization_id: org.id,
          status: 'active',
        },
      });
      console.log('✅ Demo organization and org admin created');
    }

    console.log('\n🎉 Seeding complete!\n');
    console.log('─────────────────────────────────────────');
    console.log('District Admin Login  → POST /api/auth/district-admin/login');
    console.log('  Email:    admin.gasabo@gov.rw');
    console.log('  Password: Admin@1234');
    console.log('Org Admin Login       → POST /api/auth/login');
    console.log('  Email:    orgadmin@demo.rw');
    console.log('  Password: Admin@1234');
    console.log('─────────────────────────────────────────\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
