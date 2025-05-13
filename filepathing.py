import pandas as pd
import zipfile
from io import TextIOWrapper
from pathlib import Path
from IPython.display import display

zip_path = Path('CGMacrosFiles.zip')
macro_cols = ['Calories', 'Carbs', 'Protein', 'Fat', 'Fiber']
meal_windows = []

with zipfile.ZipFile(zip_path, 'r') as archive:
    with archive.open('bio.csv') as bio_file:
        bio_df = pd.read_csv(TextIOWrapper(bio_file, 'utf-8'))
    
    bio_df['ParticipantID'] = range(1, len(bio_df) + 1)
    
    for member in archive.namelist():
        if not (member.startswith('CGMacros-') and member.endswith('.csv')):
            continue
        
        with archive.open(member) as data_file:
            df = pd.read_csv(
                TextIOWrapper(data_file, 'utf-8'),
                parse_dates=['Timestamp']
            )
        
        pid = int(Path(member).stem.split('-')[-1])
        df['ParticipantID'] = pid
        
        meals = df[df[macro_cols].notnull().any(axis=1)].copy()
        
        for _, meal in meals.iterrows():
            t0 = meal['Timestamp']
            window = df[
                (df['Timestamp'] >= t0 - pd.Timedelta(minutes=15)) &
                (df['Timestamp'] <= t0 + pd.Timedelta(minutes=180))
            ].copy()
            
            window['MinutesSinceMeal'] = (
                window['Timestamp'] - t0
            ).dt.total_seconds() / 60.0
            
            for col in macro_cols:
                window[f'{col}_Meal'] = meal[col]
            window['MealType']      = meal['Meal Type']
            window['MealTimestamp'] = t0
            window['ParticipantID'] = pid
            
            meal_windows.append(window)

combined = pd.concat(meal_windows, ignore_index=True)
final_df = combined.merge(bio_df, on='ParticipantID', how='left')
final_df = final_df.drop(columns=['Calories','Carbs','Protein','Fat','Fiber'])

final_df['Libre GL'] = final_df['Libre GL'].ffill()
final_df['Dexcom GL'] = final_df['Dexcom GL'].ffill()
final_df['HR'] = final_df['HR'].interpolate()

df = final_df.copy()
df['HealthGroup'] = pd.cut(
    df['A1c PDL (Lab)'],
    bins=[0, 5.7, 6.4, df['A1c PDL (Lab)'].max()],
    labels=['Healthy','Pre-diabetic','Type 2 diabetic']
)
df = df[df['HealthGroup'] != 'Pre-diabetic']

df = df[(df['MinutesSinceMeal'] >= 0) & (df['MinutesSinceMeal'] <= 120)]
df = df[df['Libre GL'].notna()] 

agg = (
    df
    .groupby(['MealType','HealthGroup','MinutesSinceMeal'], observed=True)
    .agg({
        'Libre GL': ['mean','std'],
        'Dexcom GL': ['mean','std']
    })
    .reset_index()
)

# Flatten columns
agg.columns = ['MealType', 'HealthGroup', 'MinutesSinceMeal',
               'Libre GL mean', 'Libre GL std', 'Dexcom GL mean', 'Dexcom GL std']

# Clean strings
agg['MealType'] = agg['MealType'].str.strip().str.capitalize()
agg['HealthGroup'] = agg['HealthGroup'].astype(str).str.strip().str.replace('-', '- ', regex=False).str.capitalize()

# Keep only valid groups
agg = agg[agg['HealthGroup'].isin(['Healthy', 'Type 2 diabetic'])]

# Export
agg.to_csv('glucose_curves_summary.csv', index=False)