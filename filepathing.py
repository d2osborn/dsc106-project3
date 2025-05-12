import pandas as pd
import glob
import os

bio_df = pd.read_csv('bio.csv')

# This will store all the extracted meal rows
meal_events = []

# Match all CGMacros participant files in the current folder
file_paths = glob.glob('CGMacros-*.csv')

for path in file_paths:
    # Read the participant file
    df = pd.read_csv(path, parse_dates=['Timestamp'])

    # Extract participant ID from filename, e.g., "CGMacros-03.csv" → 3
    participant_id = int(path.split('-')[-1].split('.')[0])
    df['ParticipantID'] = participant_id

    # Filter rows that represent actual meals (i.e., not all null macro fields)
    meal_df = df[df[['Calories', 'Carbs', 'Protein', 'Fat', 'Fiber']].notnull().any(axis=1)]
    meal_df = meal_df.dropna(subset=['Calories', 'Carbs', 'Protein', 'Fat', 'Fiber'], how='all')

    # Store for merging
    meal_events.append(meal_df)

# Combine all meals from all participants
all_meals_df = pd.concat(meal_events, ignore_index=True)

# Merge with participant metadata
bio_df['ParticipantID'] = bio_df['ParticipantID'].astype(int)
all_meals_df = all_meals_df.merge(bio_df, on='ParticipantID', how='left')

# Output preview
print(all_meals_df.head())